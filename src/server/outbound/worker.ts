import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@/generated/prisma/client";
import { isId } from "@/server/repositories/shared";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import { WhatsAppProviderError, type WhatsAppProvider } from "@/server/whatsapp";
import { buildMessageContent } from "./content";
import { isContactEligibleForProactive, isOptOutConfirmationAllowed } from "./eligibility";
import { isMessageType } from "./templates";
import { OUTBOUND_QUEUE, retryDelayMs, RETRY_DELAYS_MS, type OutboundJobData } from "./queue";
import { evaluateSendPolicy, nextSendAllowedAt, type SendDecision } from "./send-policy";
import { createTenantThrottle, type TenantThrottle } from "./tenant-throttle";

// Worker da fila de envio (guia 6, 7a, 7b, 7e; D3, D7, D10, D12). Único lugar do produto que
// chama `sendText` (teste de varredura). A cada tentativa, nesta ordem:
//   1. valida o tenantId no banco: a linha do envio tem de existir nesse tenant;
//   2. linha que já saiu de `queued` não envia de novo (evento duplicado, job repetido);
//   3. elegibilidade (bloqueio com motivo; a confirmação de opt-out tem a regra da D15) e conteúdo do template (bloqueio com motivo);
//   4. trava do número (um envio por tenant por vez; outros tenants seguem em paralelo);
//   5. política: expira, adia (teto, janela, intervalo) ou envia; a vaga do teto é consumida no
//      banco antes do envio e devolvida se o envio falhar, então retentativa não gasta o teto;
//   6. `sendText` pelo adapter e registro em `outbound_messages` e na conversa.
// Falha do provedor ou do banco: retentativa em 1, 5 e 15 min; esgotadas, `failed`.

export type SendOutcome =
  | { outcome: "sent"; externalId: string }
  | { outcome: "blocked"; reason: string }
  | { outcome: "expired" }
  | { outcome: "skipped"; status: string }
  | { outcome: "discarded"; reason: "invalid_tenant" | "unknown_message" };

export type OutboundLog = (event: string, fields?: Record<string, unknown>) => void;

export interface OutboundProcessorDeps {
  provider: WhatsAppProvider;
  throttle: TenantThrottle;
  db?: PrismaClient;
  now?: () => Date;
  random?: () => number;
  // Fim do intervalo depois de um envio; padrão: 8 a 25 s ao acaso (D3).
  nextSendAt?: (sentAt: Date) => Date;
  // Espera para tentar de novo quando outro job do mesmo tenant está com a trava.
  lockRetryMs?: number;
  log?: OutboundLog;
}

const LOCK_RETRY_MS = 2_000;

const silentLog: OutboundLog = () => {};

async function defer(job: Job<OutboundJobData>, token: string | undefined, until: Date): Promise<never> {
  await job.moveToDelayed(until.getTime(), token);
  throw new DelayedError();
}

const isLastAttempt = (job: Job<OutboundJobData>): boolean => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

export function createOutboundProcessor(deps: OutboundProcessorDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? silentLog;
  const nextSendAt = deps.nextSendAt ?? ((sentAt: Date) => nextSendAllowedAt(sentAt, deps.random));

  // Etapas 3 a 6. Lança para retentar; DelayedError para adiar.
  async function attempt(
    job: Job<OutboundJobData>,
    token: string | undefined,
    repo: TenantRepository,
    message: { id: string; contactId: string; messageType: string; scheduledFor: Date },
  ): Promise<SendOutcome> {
    const { tenantId } = job.data;
    if (!isMessageType(message.messageType)) {
      await repo.outboundMessages.markBlocked(message.id, "unknown_message_type");
      return { outcome: "blocked", reason: "unknown_message_type" };
    }
    const type = message.messageType;

    // A confirmação de opt-out tem regra própria (D15); todo o resto é proativo e o opt-out bloqueia.
    const eligibility =
      type === "optout_confirmation"
        ? await isOptOutConfirmationAllowed(repo, message.contactId, now())
        : await isContactEligibleForProactive(repo, message.contactId, now());
    if (!eligibility.eligible) {
      await repo.outboundMessages.markBlocked(message.id, eligibility.reason);
      return { outcome: "blocked", reason: eligibility.reason };
    }

    const template = await repo.messageTemplates.getByType(type);
    if (!template.active) {
      await repo.outboundMessages.markBlocked(message.id, "template_inactive");
      return { outcome: "blocked", reason: "template_inactive" };
    }
    const content = await buildMessageContent(repo, type, message.contactId, job.data.appointmentId);
    if (!content.ok) {
      await repo.outboundMessages.markBlocked(message.id, content.reason);
      return { outcome: "blocked", reason: content.reason };
    }

    // Sem conexão ativa não há como enviar agora: retentativa (o e-mail entra na Fase 8).
    const [connection, counter] = await Promise.all([repo.whatsappConnection.get(), repo.sendCounter.getState()]);
    if (!connection || !counter || connection.status !== "connected") {
      throw new WhatsAppProviderError("not_connected", "Sessão do WhatsApp não está conectada.");
    }

    const lock = await deps.throttle.acquire(tenantId);
    if (!lock) return defer(job, token, new Date(Date.now() + (deps.lockRetryMs ?? LOCK_RETRY_MS)));
    try {
      const policyInput = {
        messageType: type,
        dueAt: message.scheduledFor,
        now: now(),
        timezone: counter.timezone,
        firstConnectedAt: counter.firstConnectedAt,
        manualLimit: counter.manualLimit,
        counter: { sentCount: counter.sentCount, countDate: counter.countDate },
        notBefore: await deps.throttle.getNotBefore(tenantId),
      };
      const handle = async (decision: Exclude<SendDecision, { action: "send" }>): Promise<SendOutcome> => {
        if (decision.action === "expire") {
          await repo.outboundMessages.markExpired(message.id);
          return { outcome: "expired" };
        }
        log("outbound_deferred", { tenantId, outboundMessageId: message.id, reason: decision.reason });
        return defer(job, token, decision.until);
      };

      const decision = evaluateSendPolicy(policyInput);
      if (decision.action !== "send") return handle(decision);
      // O contador do banco é a palavra final do teto (outro worker pode ter consumido antes).
      if ((await repo.sendCounter.consume(decision.day, decision.limit)) === null) {
        const full = evaluateSendPolicy({ ...policyInput, counter: { sentCount: decision.limit, countDate: decision.day } });
        if (full.action !== "send") return handle(full);
        return defer(job, token, new Date(Date.now() + (deps.lockRetryMs ?? LOCK_RETRY_MS)));
      }

      let result;
      const chosen = await repo.messageTemplates.chooseFor(message.contactId, type, deps.random);
      const text = content.render(chosen.text);
      try {
        result = await deps.provider.sendText({ sessionId: connection.sessionId, to: content.phone, text });
      } catch (error) {
        await repo.sendCounter.release(decision.day);
        throw error;
      }
      const sentAt = now();
      await deps.throttle.setNotBefore(tenantId, nextSendAt(sentAt));
      const sent = {
        channel: "whatsapp" as const,
        externalId: result.externalId,
        sentAt,
        templateVariant: chosen.variant,
        body: text,
        deliveryState: result.state,
      };
      try {
        await repo.outboundMessages.markSent(message.id, sent);
      } catch {
        // Já saiu pelo WhatsApp: nunca retentar (seria envio duplicado). Uma segunda gravação; se
        // também falhar, fica no log para conferência manual.
        try {
          await repo.outboundMessages.markSent(message.id, sent);
        } catch {
          log("outbound_sent_not_recorded", { tenantId, outboundMessageId: message.id });
          throw new UnrecoverableError("sent_not_recorded");
        }
      }
      return { outcome: "sent", externalId: result.externalId };
    } finally {
      await deps.throttle.release(tenantId, lock);
    }
  }

  return async function process(job: Job<OutboundJobData>, token?: string): Promise<SendOutcome> {
    const { tenantId, outboundMessageId } = job.data;
    // Etapa 1: o tenantId do job só vale se a linha do envio existir nesse tenant.
    if (!isId(tenantId)) return { outcome: "discarded", reason: "invalid_tenant" };
    const repo = createTenantRepository(tenantId, deps.db);
    const message = await repo.outboundMessages.findById(outboundMessageId);
    if (!message) {
      log("outbound_discarded", { outboundMessageId, reason: "unknown_message" });
      return { outcome: "discarded", reason: "unknown_message" };
    }
    // Etapa 2: idempotência.
    if (message.status !== "queued") return { outcome: "skipped", status: message.status };

    try {
      const outcome = await attempt(job, token, repo, message);
      log("outbound_done", { tenantId, outboundMessageId, ...outcome });
      return outcome;
    } catch (error) {
      if (error instanceof DelayedError || error instanceof UnrecoverableError) throw error;
      const last = isLastAttempt(job);
      log("outbound_attempt_failed", {
        tenantId,
        outboundMessageId,
        attempt: job.attemptsMade + 1,
        final: last,
        error: error instanceof WhatsAppProviderError ? error.code : error instanceof Error ? error.name : "unknown",
      });
      if (last) await repo.outboundMessages.markFailed(outboundMessageId);
      throw error;
    }
  };
}

export interface OutboundWorkerOptions extends Omit<OutboundProcessorDeps, "throttle"> {
  connection: Redis;
  // Conexão para a trava e o intervalo; padrão: a mesma do worker.
  commands?: Redis;
  prefix?: string;
  concurrency?: number;
  retryDelaysMs?: readonly number[];
}

// Concorrência global entre tenants; dentro de um tenant, a trava serializa.
const CONCURRENCY = 10;

export function createOutboundWorker(options: OutboundWorkerOptions): Worker<OutboundJobData, SendOutcome> {
  const throttle = createTenantThrottle(options.commands ?? options.connection, options.prefix);
  const processor = createOutboundProcessor({ ...options, throttle });
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  return new Worker<OutboundJobData, SendOutcome>(OUTBOUND_QUEUE, processor, {
    connection: options.connection,
    ...(options.prefix ? { prefix: options.prefix } : {}),
    concurrency: options.concurrency ?? CONCURRENCY,
    settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade, delays) },
  });
}
