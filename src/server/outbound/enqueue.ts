import type { Queue } from "bullmq";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { createProducerConnection } from "@/server/queue/connection";
import { createTenantRepository } from "@/server/repositories/tenant-repository";
import { OUTBOUND_MESSAGE_TYPES } from "./message-types";
import { createOutboundQueue, SEND_JOB, type OutboundJobData } from "./queue";
import { sendPriority } from "./send-policy";

// Serviço único de envio (guia 3, 6; D12): todo envio do sistema entra por aqui e só o worker
// chama `sendText`. Grava a linha `queued` pela chave de idempotência e põe o job na fila. O
// mesmo evento devolve `duplicate` e nunca gera um segundo envio. Fila fora do ar: a linha vira
// `failed` (visível no registro) e quem chamou segue normalmente; nunca lança por causa do Redis.

export const enqueueInputSchema = z
  .object({
    tenantId: z.uuid(),
    contactId: z.uuid(),
    messageType: z.enum(OUTBOUND_MESSAGE_TYPES),
    // Estável por evento, ex.: `appointment_confirmation:<appointmentId>`.
    idempotencyKey: z.string().trim().min(1).max(255),
    // Quando deveria sair; ausente = agora. Base da expiração de 24 h (D7).
    scheduledFor: z.date().optional(),
    appointmentId: z.uuid().nullish(),
  })
  .refine((input) => input.messageType !== "appointment_confirmation" || !!input.appointmentId, {
    error: "A confirmação de agendamento exige appointmentId.",
    path: ["appointmentId"],
  });

export type EnqueueInput = z.input<typeof enqueueInputSchema>;

export type EnqueueResult =
  | { status: "queued"; outboundMessageId: string }
  // O evento já tinha sido enfileirado; `current` é o status atual do envio.
  | { status: "duplicate"; outboundMessageId: string; current: string }
  | { status: "failed"; outboundMessageId: string; reason: "queue_unavailable" }
  | { status: "rejected"; reason: "contact_not_found" };

export interface EnqueueDeps {
  queue?: Queue<OutboundJobData>;
  db?: PrismaClient;
  now?: () => Date;
  // Prazo para o Redis aceitar o job antes de dar a fila como fora do ar.
  queueTimeoutMs?: number;
}

const QUEUE_TIMEOUT_MS = 3_000;

const globalForQueue = globalThis as typeof globalThis & { slotzOutboundQueue?: Queue<OutboundJobData> };

// Uma fila por processo, com a conexão que falha rápido (D12). O erro de conexão vai para o log
// sem URL nem senha.
function defaultQueue(): Queue<OutboundJobData> {
  if (!globalForQueue.slotzOutboundQueue) {
    const connection = createProducerConnection();
    connection.on("error", (error) =>
      console.error(JSON.stringify({ event: "outbound_queue_redis_error", error: error.name })),
    );
    globalForQueue.slotzOutboundQueue = createOutboundQueue(connection);
  }
  return globalForQueue.slotzOutboundQueue;
}

async function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("queue_timeout")), ms);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function enqueueMessage(input: EnqueueInput, deps: EnqueueDeps = {}): Promise<EnqueueResult> {
  const data = enqueueInputSchema.parse(input);
  const now = deps.now?.() ?? new Date();
  const scheduledFor = data.scheduledFor ?? now;
  const repo = createTenantRepository(data.tenantId, deps.db);

  const created = await repo.outboundMessages.create({
    contactId: data.contactId,
    messageType: data.messageType,
    idempotencyKey: data.idempotencyKey,
    scheduledFor,
  });
  if (!created) return { status: "rejected", reason: "contact_not_found" };
  const { message } = created;
  // Evento repetido com desfecho já registrado: nada a fazer.
  if (!created.created && message.status !== "queued") {
    return { status: "duplicate", outboundMessageId: message.id, current: message.status };
  }

  const job: OutboundJobData = {
    tenantId: data.tenantId,
    outboundMessageId: message.id,
    idempotencyKey: data.idempotencyKey,
    appointmentId: data.appointmentId ?? null,
  };
  try {
    // jobId = id da linha: se o job ainda existe, o BullMQ ignora a segunda inclusão.
    await withTimeout(
      (deps.queue ?? defaultQueue()).add(SEND_JOB, job, {
        jobId: message.id,
        priority: sendPriority(data.messageType),
        delay: Math.max(0, scheduledFor.getTime() - now.getTime()),
      }),
      deps.queueTimeoutMs ?? QUEUE_TIMEOUT_MS,
    );
  } catch {
    await repo.outboundMessages.markFailed(message.id);
    console.error(
      JSON.stringify({ event: "outbound_enqueue_failed", tenantId: data.tenantId, outboundMessageId: message.id }),
    );
    return { status: "failed", outboundMessageId: message.id, reason: "queue_unavailable" };
  }
  return created.created
    ? { status: "queued", outboundMessageId: message.id }
    : { status: "duplicate", outboundMessageId: message.id, current: message.status };
}
