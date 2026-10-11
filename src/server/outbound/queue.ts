import { Queue } from "bullmq";
import type { Redis } from "ioredis";

// Fila de envio (guia 6; D1, D10). Um job por linha de `outbound_messages`, com o id da linha
// como jobId: o mesmo envio nunca vira dois jobs. O payload só leva ids e a chave de
// idempotência (impacto "Segurança"); o texto é montado no worker, a partir do banco.

export const OUTBOUND_QUEUE = "outbound";
export const SEND_JOB = "send";

export interface OutboundJobData {
  tenantId: string;
  outboundMessageId: string;
  idempotencyKey: string;
  // Assunto do evento, só para os tipos que precisam (confirmação de agendamento).
  appointmentId: string | null;
}

// D10: retentativas com espera crescente de 1, 5 e 15 min depois da primeira tentativa. Esgotadas,
// o envio fica `failed`.
export const RETRY_DELAYS_MS: readonly number[] = [60_000, 300_000, 900_000];
export const OUTBOUND_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const OUTBOUND_BACKOFF_TYPE = "outbound";

// Espera antes da retentativa número `attemptsMade` (1 = primeira retentativa).
export function retryDelayMs(attemptsMade: number, delays: readonly number[] = RETRY_DELAYS_MS): number {
  return delays[Math.min(Math.max(attemptsMade, 1), delays.length) - 1];
}

export interface OutboundQueueOptions {
  // Só testes: isola as chaves do Redis de cada suíte.
  prefix?: string;
}

export function createOutboundQueue(connection: Redis, options: OutboundQueueOptions = {}): Queue<OutboundJobData> {
  return new Queue<OutboundJobData>(OUTBOUND_QUEUE, {
    connection,
    ...(options.prefix ? { prefix: options.prefix } : {}),
    defaultJobOptions: {
      attempts: OUTBOUND_ATTEMPTS,
      backoff: { type: OUTBOUND_BACKOFF_TYPE },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}
