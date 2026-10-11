import { randomUUID } from "node:crypto";
import { QueueEvents, type Queue, type Worker } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Contact, OutboundMessage, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enqueueMessage } from "@/server/outbound/enqueue";
import {
  createOutboundQueue,
  OUTBOUND_ATTEMPTS,
  retryDelayMs,
  SEND_JOB,
  type OutboundJobData,
} from "@/server/outbound/queue";
import { tenantDay } from "@/server/outbound/send-policy";
import { createTenantThrottle } from "@/server/outbound/tenant-throttle";
import { createOutboundWorker, type SendOutcome } from "@/server/outbound/worker";
import { createProducerConnection, createWorkerConnection } from "@/server/queue/connection";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import { FakeProvider, WhatsAppProviderError, type WhatsAppProvider } from "@/server/whatsapp";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 6: fila e worker de envio, de ponta a ponta com o Redis local dos testes
// (docker-compose.test.yml), a branch test do Neon e o FakeProvider. Retentativas com espera de
// 100, 200 e 300 ms no lugar de 1, 5 e 15 min (a curva real é conferida à parte), e intervalo
// entre envios de 50 ms no lugar de 8 a 25 s (a política pura é da Fase 4).

const testRedisUrl = process.env.TEST_REDIS_URL as string;
const prefix = `test-outbound-${randomUUID().slice(0, 8)}`;
const TEST_RETRY_DELAYS = [100, 200, 300];
const WAIT_MS = 15_000;

const fake = new FakeProvider();
// Falhas simuladas do provedor: cada unidade derruba um sendText antes de chegar ao Fake.
let failuresLeft = 0;
const provider = {
  source: fake.source,
  sendText: async (input) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new WhatsAppProviderError("provider_unavailable", "Provedor fora do ar (simulado).");
    }
    return fake.sendText(input);
  },
} as Pick<WhatsAppProvider, "source" | "sendText"> as WhatsAppProvider;

const logs: { event: string; fields: Record<string, unknown> }[] = [];

let workerConnection: Redis;
let producerConnection: Redis;
let queue: Queue<OutboundJobData>;
let events: QueueEvents;
let worker: Worker<OutboundJobData, SendOutcome>;

interface Scenario {
  tenant: Tenant;
  repo: TenantRepository;
  sessionId: string;
  professionalId: string;
  serviceId: string;
}
const tenants: Tenant[] = [];
let main: Scenario;
let hour = 0;

const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const sentTo = (to: string) => fake.sentMessages.filter((m) => m.to === to);

async function scenario(label: string): Promise<Scenario> {
  const tenant = await createTestTenant(label);
  tenants.push(tenant);
  const repo = createTenantRepository(tenant.id);
  const { sessionId } = await fake.connect();
  await fake.simulateQrScan(sessionId);
  await repo.whatsappConnection.save({ sessionId, status: "connected" });
  const professional = await repo.professionals.create({ name: "Ana Souza" });
  const service = await repo.services.create({ name: "Corte de cabelo", durationMinutes: 30, priceCents: 5000 });
  return { tenant, repo, sessionId, professionalId: professional.id, serviceId: service.id };
}

async function contact(s: Scenario, data: Partial<Contact> = {}): Promise<Contact> {
  const created = await s.repo.contacts.findOrCreateByPhone({ name: "Maria Lima", phone: phone() });
  return prisma.contact.update({ where: { id: created.id }, data });
}

async function appointment(s: Scenario, contactId: string): Promise<string> {
  const startsAt = new Date(Date.UTC(2027, 0, 5, 13 + (hour % 8), 0) + Math.floor(hour++ / 8) * 86_400_000);
  const created = await s.repo.appointments.create({
    professionalId: s.professionalId,
    serviceId: s.serviceId,
    contactId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
  });
  if (!created) throw new Error("agendamento de teste não criado");
  return created.id;
}

// Contato com agendamento `confirmed` (elegível pela regra b) e o envio da confirmação.
async function confirmation(s: Scenario, extra: { scheduledFor?: Date } = {}) {
  const c = await contact(s);
  const appointmentId = await appointment(s, c.id);
  const input = {
    tenantId: s.tenant.id,
    contactId: c.id,
    messageType: "appointment_confirmation" as const,
    idempotencyKey: `appointment_confirmation:${appointmentId}`,
    appointmentId,
    ...extra,
  };
  return { contact: c, appointmentId, input };
}

async function settle(s: Scenario, id: string): Promise<OutboundMessage> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const row = await s.repo.outboundMessages.findById(id);
    if (row && row.status !== "queued") return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`envio ${id} continuou queued`);
}

async function waitForJobState(id: string, state: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const job = await queue.getJob(id);
    if (job && (await job.getState()) === state) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${id} não chegou a ${state}`);
}

async function counter(s: Scenario) {
  return (await s.repo.sendCounter.getState())!;
}

async function resetCounter(s: Scenario) {
  await prisma.whatsAppConnection.update({
    where: { tenantId: s.tenant.id },
    data: { dailySentCount: 0, dailyCountDate: null },
  });
}

beforeAll(async () => {
  workerConnection = createWorkerConnection(testRedisUrl);
  producerConnection = createProducerConnection(testRedisUrl);
  queue = createOutboundQueue(producerConnection, { prefix });
  events = new QueueEvents("outbound", { connection: createWorkerConnection(testRedisUrl), prefix });
  worker = createOutboundWorker({
    connection: workerConnection,
    prefix,
    provider,
    retryDelaysMs: TEST_RETRY_DELAYS,
    nextSendAt: (sentAt) => new Date(sentAt.getTime() + 50),
    lockRetryMs: 100,
    // OUTBOUND_DEBUG=1 mostra o log do worker durante o teste.
    log: (event, fields = {}) => {
      if (process.env.OUTBOUND_DEBUG) console.log(new Date().toISOString(), event, JSON.stringify(fields));
      logs.push({ event, fields });
    },
  });
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
  main = await scenario("envio");
}, 60_000);

afterAll(async () => {
  await worker?.close();
  await events?.close();
  await queue?.obliterate({ force: true }).catch(() => {});
  await queue?.close();
  await Promise.all([workerConnection, producerConnection].map((c) => c?.quit().catch(() => c.disconnect())));
  await deleteTestTenants(...tenants);
}, 60_000);

beforeEach(async () => {
  failuresLeft = 0;
  await resetCounter(main);
});

describe("retentativa (D10)", () => {
  it("3 retentativas depois da primeira, com 1, 5 e 15 min de espera", () => {
    expect(OUTBOUND_ATTEMPTS).toBe(4);
    expect([1, 2, 3].map((n) => retryDelayMs(n))).toEqual([60_000, 300_000, 900_000]);
  });
});

describe("fila e worker de envio", () => {
  it("envio: sai pelo sendText do adapter, registra sent e grava na conversa; o job só leva ids", async () => {
    const { contact: c, appointmentId, input } = await confirmation(main);
    const result = await enqueueMessage(input, { queue });
    expect(result.status).toBe("queued");
    if (result.status !== "queued") return;

    const job = await queue.getJob(result.outboundMessageId);
    expect(Object.keys(job!.data).sort()).toEqual(["appointmentId", "idempotencyKey", "outboundMessageId", "tenantId"]);
    expect(job!.data).toEqual({
      tenantId: main.tenant.id,
      outboundMessageId: result.outboundMessageId,
      idempotencyKey: `appointment_confirmation:${appointmentId}`,
      appointmentId,
    });

    const row = await settle(main, result.outboundMessageId);
    expect(row).toMatchObject({ status: "sent", channel: "whatsapp", blockReason: null });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.templateVariant).toBeGreaterThanOrEqual(0);

    const sent = sentTo(c.phone);
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe(main.sessionId);
    expect(row.externalId).toBe(sent[0].externalId);
    // Texto montado no worker a partir do banco, nunca vindo do job.
    expect(sent[0].text).toContain("Maria Lima");
    expect(sent[0].text).toContain("Corte de cabelo");
    expect(sent[0].text).toContain("Ana Souza");
    expect(sent[0].text).toMatch(/\d{2}\/\d{2}\/2027/);
    expect(JSON.stringify(job!.data)).not.toContain("Corte");

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: main.tenant.id, contactId: c.id },
      include: { messages: true },
    });
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]).toMatchObject({
      direction: "outbound",
      status: "sent",
      body: sent[0].text,
      externalId: sent[0].externalId,
    });
    expect((await counter(main)).sentCount).toBe(1);
  });

  it("bloqueio por inelegível: registrado com o motivo, sem sendText e sem gastar o teto", async () => {
    // Proativo para contato em opt-out, mesmo com agendamento `confirmed` e consentimento: opt_out
    // vence. "Sem regra" (not_eligible) com proativo: teste do agendamento cancelado, abaixo.
    // A confirmação de opt-out tem regra própria (D15, Fase 7): para quem não está em opt-out sai
    // not_opted_out, e para quem está, mas não escreveu nos últimos 30 dias, not_eligible.
    const { contact: saiu, input } = await confirmation(main);
    await prisma.contact.update({ where: { id: saiu.id }, data: { optOut: true, consentAt: new Date() } });
    const semRegra = await contact(main);
    const saiuSemMensagem = await contact(main, { optOut: true, consentAt: new Date() });
    const optOutConfirmation = (c: Contact) =>
      enqueueMessage(
        {
          tenantId: main.tenant.id,
          contactId: c.id,
          messageType: "optout_confirmation",
          idempotencyKey: `teste-inelegivel:${c.id}`,
        },
        { queue },
      );
    const results = await Promise.all([
      enqueueMessage(input, { queue }),
      optOutConfirmation(semRegra),
      optOutConfirmation(saiuSemMensagem),
    ]);
    const rows = await Promise.all(
      results.map((r) => settle(main, (r as { outboundMessageId: string }).outboundMessageId)),
    );
    expect(rows.map((r) => [r.status, r.blockReason])).toEqual([
      ["blocked", "opt_out"],
      ["blocked", "not_opted_out"],
      ["blocked", "not_eligible"],
    ]);
    expect(rows.every((r) => r.sentAt === null && r.channel === null)).toBe(true);
    expect([saiu, semRegra, saiuSemMensagem].flatMap((c) => sentTo(c.phone))).toEqual([]);
    expect((await counter(main)).sentCount).toBe(0);
  });

  it("bloqueio quando o agendamento foi cancelado antes do envio (contato sem outra regra)", async () => {
    const { contact: c, appointmentId, input } = await confirmation(main);
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "canceled", canceledAt: new Date() } });
    const result = await enqueueMessage(input, { queue });
    const row = await settle(main, (result as { outboundMessageId: string }).outboundMessageId);
    expect([row.status, row.blockReason]).toEqual(["blocked", "not_eligible"]);
    expect(sentTo(c.phone)).toEqual([]);
  });

  it("adiado por teto: com o teto do dia cheio, o job espera (delayed) e nada é enviado", async () => {
    const full = await scenario("teto");
    const state = await counter(full);
    // Primeira conexão agora: dia 1 do aquecimento, teto 20 (D3).
    await prisma.whatsAppConnection.update({
      where: { tenantId: full.tenant.id },
      data: { dailySentCount: 20, dailyCountDate: new Date(`${tenantDay(new Date(), state.timezone)}T00:00:00Z`) },
    });
    const { contact: c, input } = await confirmation(full);
    const result = await enqueueMessage(input, { queue });
    if (result.status !== "queued") throw new Error(result.status);

    await waitForJobState(result.outboundMessageId, "delayed");
    const deferred = logs.find(
      (l) => l.event === "outbound_deferred" && l.fields.outboundMessageId === result.outboundMessageId,
    );
    expect(deferred?.fields.reason).toBe("daily_limit");
    expect((await full.repo.outboundMessages.findById(result.outboundMessageId))?.status).toBe("queued");
    expect(sentTo(c.phone)).toEqual([]);
    expect((await counter(full)).sentCount).toBe(20);
    // A espera vai até o dia seguinte no fuso do tenant.
    const job = await queue.getJob(result.outboundMessageId);
    const score = await producerConnection.zscore(`${prefix}:outbound:delayed`, result.outboundMessageId);
    const runAt = score === null ? null : Math.floor(Number(score) / 0x1000);
    expect(job).toBeTruthy();
    expect(runAt).not.toBeNull();
    expect(tenantDay(new Date(runAt!), state.timezone) > tenantDay(new Date(), state.timezone)).toBe(true);
  });

  it("expirado: mais de 24 h de atraso vira expired, sem envio e sem gastar o teto", async () => {
    const { contact: c, input } = await confirmation(main, {
      scheduledFor: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const result = await enqueueMessage(input, { queue });
    const row = await settle(main, (result as { outboundMessageId: string }).outboundMessageId);
    expect(row.status).toBe("expired");
    expect(sentTo(c.phone)).toEqual([]);
    expect((await counter(main)).sentCount).toBe(0);
  });

  it("retentativa sem gastar o teto: 2 falhas do provedor e sucesso na 3ª tentativa contam 1 envio", async () => {
    failuresLeft = 2;
    const { contact: c, input } = await confirmation(main);
    const result = await enqueueMessage(input, { queue });
    const row = await settle(main, (result as { outboundMessageId: string }).outboundMessageId);
    expect(row.status).toBe("sent");
    expect(sentTo(c.phone)).toHaveLength(1);
    expect((await counter(main)).sentCount).toBe(1);
    // O BullMQ conta também a tentativa concluída: 2 falhas + 1 sucesso.
    const job = await queue.getJob(row.id);
    expect(job?.attemptsMade).toBe(3);
    const attempts = logs.filter((l) => l.event === "outbound_attempt_failed" && l.fields.outboundMessageId === row.id);
    expect(attempts.map((l) => [l.fields.attempt, l.fields.final, l.fields.error])).toEqual([
      [1, false, "provider_unavailable"],
      [2, false, "provider_unavailable"],
    ]);
  });

  it("falha final: 4 tentativas sem sucesso ficam failed e devolvem a vaga do teto", async () => {
    failuresLeft = 100;
    const { contact: c, input } = await confirmation(main);
    const result = await enqueueMessage(input, { queue });
    const row = await settle(main, (result as { outboundMessageId: string }).outboundMessageId);
    expect(row.status).toBe("failed");
    expect(sentTo(c.phone)).toEqual([]);
    expect((await counter(main)).sentCount).toBe(0);
    await waitForJobState(row.id, "failed");
    expect((await queue.getJob(row.id))?.attemptsMade).toBe(OUTBOUND_ATTEMPTS);
  });

  it("evento duplicado envia uma vez: enfileirar 3 vezes ao mesmo tempo e de novo depois", async () => {
    const { contact: c, input } = await confirmation(main);
    const results = await Promise.all([1, 2, 3].map(() => enqueueMessage(input, { queue })));
    const ids = new Set(results.map((r) => (r as { outboundMessageId: string }).outboundMessageId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === "queued")).toHaveLength(1);
    const [id] = ids;
    const row = await settle(main, id);
    expect(row.status).toBe("sent");

    const again = await enqueueMessage(input, { queue });
    expect(again).toEqual({ status: "duplicate", outboundMessageId: id, current: "sent" });
    // Job repetido para a mesma linha (ex.: reprocessado): não envia de novo.
    const rerun = await queue.add(SEND_JOB, (await queue.getJob(id))!.data, { jobId: randomUUID() });
    expect(await rerun.waitUntilFinished(events, WAIT_MS)).toEqual({ outcome: "skipped", status: "sent" });

    expect(sentTo(c.phone)).toHaveLength(1);
    expect(await prisma.outboundMessage.count({ where: { tenantId: main.tenant.id, idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect(
      await prisma.message.count({ where: { tenantId: main.tenant.id, conversation: { contactId: c.id } } }),
    ).toBe(1);
    expect((await counter(main)).sentCount).toBe(1);
  });

  it("Redis indisponível: enqueueMessage não lança, o envio fica failed e o agendamento segue", async () => {
    const dead = createProducerConnection("redis://127.0.0.1:1", { retryStrategy: () => null, lazyConnect: true });
    dead.on("error", () => {});
    const deadQueue = createOutboundQueue(dead, { prefix });
    deadQueue.on("error", () => {});
    try {
      const { contact: c, appointmentId, input } = await confirmation(main);
      const started = Date.now();
      const result = await enqueueMessage(input, { queue: deadQueue, queueTimeoutMs: 1_000 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result).toMatchObject({ status: "failed", reason: "queue_unavailable" });
      const row = await main.repo.outboundMessages.findById((result as { outboundMessageId: string }).outboundMessageId);
      expect(row?.status).toBe("failed");
      expect((await main.repo.appointments.findById(appointmentId))?.status).toBe("confirmed");
      expect(sentTo(c.phone)).toEqual([]);
      // O mesmo evento depois não reenvia: o failed fica visível como desfecho.
      expect(await enqueueMessage(input, { queue })).toMatchObject({ status: "duplicate", current: "failed" });
    } finally {
      await deadQueue.close().catch(() => {});
      dead.disconnect();
    }
  });

  it("valida o tenantId do job no banco: envio de A num job com o tenant B é descartado", async () => {
    const other = await scenario("outro");
    const { contact: c, appointmentId, input } = await confirmation(main);
    const created = await main.repo.outboundMessages.create({ ...input, scheduledFor: new Date() });
    const job = await queue.add(
      SEND_JOB,
      { tenantId: other.tenant.id, outboundMessageId: created!.message.id, idempotencyKey: input.idempotencyKey, appointmentId },
      { jobId: randomUUID() },
    );
    expect(await job.waitUntilFinished(events, WAIT_MS)).toEqual({ outcome: "discarded", reason: "unknown_message" });
    expect((await main.repo.outboundMessages.findById(created!.message.id))?.status).toBe("queued");
    expect(sentTo(c.phone)).toEqual([]);
  });

  it("concorrência por tenant: com o número de A ocupado, B envia e A espera a vez", async () => {
    const a = await scenario("conc-a");
    const b = await scenario("conc-b");
    const throttle = createTenantThrottle(producerConnection, prefix);
    const token = await throttle.acquire(a.tenant.id);
    expect(token).not.toBeNull();
    const ca = await confirmation(a);
    const cb = await confirmation(b);
    const [ra, rb] = await Promise.all([enqueueMessage(ca.input, { queue }), enqueueMessage(cb.input, { queue })]);
    const idA = (ra as { outboundMessageId: string }).outboundMessageId;

    expect((await settle(b, (rb as { outboundMessageId: string }).outboundMessageId)).status).toBe("sent");
    expect((await a.repo.outboundMessages.findById(idA))?.status).toBe("queued");
    expect(sentTo(ca.contact.phone)).toEqual([]);

    await throttle.release(a.tenant.id, token!);
    expect((await settle(a, idA)).status).toBe("sent");
    expect(sentTo(ca.contact.phone)).toHaveLength(1);
  });

  it("intervalo entre envios do mesmo número: o segundo espera o fim do intervalo", async () => {
    const first = await confirmation(main);
    const second = await confirmation(main);
    const [r1, r2] = await Promise.all([enqueueMessage(first.input, { queue }), enqueueMessage(second.input, { queue })]);
    await Promise.all([r1, r2].map((r) => settle(main, (r as { outboundMessageId: string }).outboundMessageId)));
    const [m1] = sentTo(first.contact.phone);
    const [m2] = sentTo(second.contact.phone);
    const [early, late] = [m1, m2].sort((x, y) => x.sentAt.getTime() - y.sentAt.getTime());
    expect(late.sentAt.getTime() - early.sentAt.getTime()).toBeGreaterThanOrEqual(50);
  });
});
