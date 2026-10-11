import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Contact, OutboundMessage, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import * as webhookRoute from "@/app/api/webhooks/whatsapp/route";
import { WEBHOOK_SECRET_HEADER } from "@/server/http/webhook-secret";
import { normalizeCommandText, optOutConfirmationKey, parseOptOutCommand } from "@/server/messaging/opt-out";
import { processWhatsAppWebhook, type EnqueueFn } from "@/server/messaging/webhook";
import { evaluateOptOutConfirmation, RECENT_INBOUND_WINDOW_MS } from "@/server/outbound/eligibility";
import { enqueueMessage, type EnqueueInput } from "@/server/outbound/enqueue";
import { createOutboundQueue, type OutboundJobData } from "@/server/outbound/queue";
import { createOutboundWorker, type SendOutcome } from "@/server/outbound/worker";
import { createProducerConnection, createWorkerConnection } from "@/server/queue/connection";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import {
  FakeProvider,
  getWhatsAppProvider,
  resetWhatsAppProvider,
  type FakeWebhookPayload,
} from "@/server/whatsapp";
import { createRouteCaller, type RouteModule } from "./helpers/api-routes";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 7: opt-out por mensagem (guia 6, 7c; D4, D15). Detecção pura e, de ponta a ponta, o
// webhook (função e rota real) gravando `opt_out` na hora, a confirmação única pela fila e o
// worker com o FakeProvider, o Redis local dos testes e a branch test do Neon. O relógio do
// worker é deslocado para 12h do fuso do tenant: a confirmação respeita a janela de 8h às 20h
// (D11) e o teste não pode depender da hora em que roda.

const testRedisUrl = process.env.TEST_REDIS_URL as string;
const prefix = `test-optout-${randomUUID().slice(0, 8)}`;
const SECRET = randomBytes(24).toString("base64url");
const WAIT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const noonOffsetMs = (() => {
  const real = DateTime.now().setZone("America/Sao_Paulo");
  return real.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toMillis() - real.toMillis();
})();
const workerNow = () => new Date(Date.now() + noonOffsetMs);

let fake: FakeProvider;
let workerConnection: Redis;
let producerConnection: Redis;
let queue: Queue<OutboundJobData>;
let worker: Worker<OutboundJobData, SendOutcome>;
const tenants: Tenant[] = [];
const usedIps: string[] = [];

interface Scenario {
  tenant: Tenant;
  repo: TenantRepository;
  sessionId: string;
}
let a: Scenario;
let b: Scenario;

const phone = () => `+55119${String(randomInt(10_000_000, 99_999_999))}`;
const sentTo = (to: string) => fake.sentMessages.filter((m) => m.to === to);
const enqueue: EnqueueFn = (input) => enqueueMessage(input, { queue });

async function scenario(label: string): Promise<Scenario> {
  const tenant = await createTestTenant(label);
  tenants.push(tenant);
  const repo = createTenantRepository(tenant.id);
  const { sessionId } = await fake.connect();
  await fake.simulateQrScan(sessionId);
  await repo.whatsappConnection.save({ sessionId, status: "connected" });
  return { tenant, repo, sessionId };
}

function inbound(s: Scenario, from: string, text: string, extra: Partial<FakeWebhookPayload> = {}) {
  return {
    type: "message",
    sessionId: s.sessionId,
    messageId: `in_${randomUUID()}`,
    from,
    profileName: "Maria Lima",
    text,
    ...extra,
  } as FakeWebhookPayload;
}

// Uma mensagem do cliente pelo webhook (sem a rota HTTP), com a fila dos testes.
const receive = (s: Scenario, from: string, text: string, enqueueFn: EnqueueFn = enqueue) =>
  processWhatsAppWebhook(fake, inbound(s, from, text), undefined, enqueueFn);

const contactOf = (s: Scenario, from: string): Promise<Contact> =>
  prisma.contact.findFirstOrThrow({ where: { tenantId: s.tenant.id, phone: from } });

const outboundOf = (s: Scenario, contactId: string): Promise<OutboundMessage[]> =>
  prisma.outboundMessage.findMany({ where: { tenantId: s.tenant.id, contactId }, orderBy: { createdAt: "asc" } });

async function settle(s: Scenario, id: string): Promise<OutboundMessage> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const row = await s.repo.outboundMessages.findById(id);
    if (row && row.status !== "queued") return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`envio ${id} continuou queued`);
}

async function confirmationOf(s: Scenario, contactId: string): Promise<OutboundMessage> {
  const rows = (await outboundOf(s, contactId)).filter((r) => r.messageType === "optout_confirmation");
  expect(rows).toHaveLength(1);
  return settle(s, rows[0].id);
}

// Proativo de exemplo: confirmação de agendamento de um contato com agendamento `confirmed`.
async function proactive(s: Scenario, contactId: string) {
  const [professional, service] = await Promise.all([
    s.repo.professionals.create({ name: "Ana Souza" }),
    s.repo.services.create({ name: "Corte de cabelo", durationMinutes: 30, priceCents: 5000 }),
  ]);
  const startsAt = new Date(Date.UTC(2027, 0, 5, 13, 0) + randomInt(0, 300) * DAY_MS);
  const created = await s.repo.appointments.create({
    professionalId: professional.id,
    serviceId: service.id,
    contactId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
  });
  if (!created) throw new Error("agendamento de teste não criado");
  const result = await enqueue({
    tenantId: s.tenant.id,
    contactId,
    messageType: "appointment_confirmation",
    idempotencyKey: `appointment_confirmation:${created.id}`,
    appointmentId: created.id,
  });
  if (result.status !== "queued") throw new Error(`proativo não enfileirado: ${result.status}`);
  return settle(s, result.outboundMessageId);
}

beforeAll(async () => {
  vi.stubEnv("WHATSAPP_PROVIDER", "fake");
  vi.stubEnv("WHATSAPP_WEBHOOK_SECRET", SECRET);
  resetWhatsAppProvider();
  fake = getWhatsAppProvider() as FakeProvider;
  workerConnection = createWorkerConnection(testRedisUrl);
  producerConnection = createProducerConnection(testRedisUrl);
  queue = createOutboundQueue(producerConnection, { prefix });
  // A rota real usa a fila do processo: aponta para a fila (com prefixo) destes testes.
  (globalThis as { slotzOutboundQueue?: Queue<OutboundJobData> }).slotzOutboundQueue = queue;
  worker = createOutboundWorker({
    connection: workerConnection,
    prefix,
    provider: fake,
    now: workerNow,
    retryDelaysMs: [100, 200, 300],
    nextSendAt: (sentAt) => new Date(sentAt.getTime() + 50),
    lockRetryMs: 100,
  });
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  [a, b] = [await scenario("optout-a"), await scenario("optout-b")];
}, 60_000);

afterAll(async () => {
  await worker?.close();
  delete (globalThis as { slotzOutboundQueue?: unknown }).slotzOutboundQueue;
  await queue?.obliterate({ force: true }).catch(() => {});
  await queue?.close();
  await Promise.all([workerConnection, producerConnection].map((c) => c?.quit().catch(() => c.disconnect())));
  await prisma.rateLimitHit.deleteMany({ where: { key: { in: usedIps } } });
  await deleteTestTenants(...tenants);
  resetWhatsAppProvider();
  vi.unstubAllEnvs();
}, 60_000);

describe("detecção (D4): só a mensagem inteira", () => {
  it.each([
    "SAIR", "sair", "Sair", "  sair  ", "S A I R", "sAiR\n", "SAÍR", "sáir",
    "PARAR", "parar", "Parar ", "PÁRAR",
    "CANCELAR", "cancelar", "Cancelár",
    "STOP", "stop", " Stop\t",
    "​sair", // caractere invisível colado pelo teclado
  ])("%j descadastra", (text) => {
    expect(parseOptOutCommand(text)).toBe("opt_out");
  });

  it.each(["VOLTAR", "voltar", " Voltar ", "VÓLTAR"])("%j reativa", (text) => {
    expect(parseOptOutCommand(text)).toBe("opt_in");
  });

  it.each([
    "quero sair",
    "Não quero SAIR",
    "sair da lista",
    "pode parar de mandar?",
    "Vou cancelar o horário de amanhã",
    "stop por favor",
    "SAIR SAIR",
    "sairr",
    "saída",
    "quero voltar",
    "",
    "   ",
  ])("%j não conta", (text) => {
    expect(parseOptOutCommand(text)).toBeNull();
  });

  it("sem texto (mídia) não conta; normalização sem acento, espaço nem caixa", () => {
    expect(parseOptOutCommand(null)).toBeNull();
    expect(normalizeCommandText(" Cancelár\n")).toBe("CANCELAR");
  });
});

describe("regra da confirmação (D15)", () => {
  const NOW = new Date("2026-10-11T15:00:00Z");
  const base = { optOut: true, lastInboundAt: new Date(NOW.getTime() - 60_000), optOutConfirmationSentAt: null };

  it("contato em opt-out que acabou de escrever recebe (regra a)", () => {
    expect(evaluateOptOutConfirmation(base, NOW)).toEqual({ eligible: true, reason: "recent_inbound" });
  });

  it("nunca repete, não vai para quem já voltou e não vai sem mensagem recente", () => {
    expect(evaluateOptOutConfirmation({ ...base, optOutConfirmationSentAt: NOW }, NOW)).toEqual({
      eligible: false,
      reason: "optout_confirmation_already_sent",
    });
    expect(evaluateOptOutConfirmation({ ...base, optOut: false }, NOW)).toEqual({ eligible: false, reason: "not_opted_out" });
    const old = new Date(NOW.getTime() - RECENT_INBOUND_WINDOW_MS - 1);
    expect(evaluateOptOutConfirmation({ ...base, lastInboundAt: old }, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
    expect(evaluateOptOutConfirmation(null, NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
  });
});

describe("opt-out pelo webhook, de ponta a ponta", () => {
  it("efeito imediato: opt_out gravado antes de o webhook responder, com a confirmação já na fila", async () => {
    const from = phone();
    const enqueued: EnqueueInput[] = [];
    // Só registra o pedido: prova que o opt-out não depende da fila nem do worker.
    const outcome = await receive(a, from, "Sair", async (input) => {
      enqueued.push(input);
      expect((await contactOf(a, from)).optOut).toBe(true);
      return { status: "rejected", reason: "contact_not_found" };
    });
    expect(outcome).toMatchObject({ status: "processed", results: { processed: 1 } });
    const c = await contactOf(a, from);
    expect(c.optOut).toBe(true);
    expect(enqueued).toEqual([
      {
        tenantId: a.tenant.id,
        contactId: c.id,
        messageType: "optout_confirmation",
        idempotencyKey: optOutConfirmationKey(c.id),
      },
    ]);
    // A mensagem "Sair" também entra na conversa, como qualquer outra.
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: a.tenant.id, contactId: c.id },
      include: { messages: true },
    });
    expect(conversation.messages.map((m) => [m.direction, m.body])).toEqual([["inbound", "Sair"]]);
  });

  it("efeito imediato sobre proativo já na fila: um envio queued vira blocked/opt_out", async () => {
    const from = phone();
    await receive(a, from, "Oi, tudo bem?");
    const c = await contactOf(a, from);
    const professional = await a.repo.professionals.create({ name: "Bia Rocha" });
    const service = await a.repo.services.create({ name: "Escova", durationMinutes: 30, priceCents: 4000 });
    const startsAt = new Date(Date.UTC(2027, 2, 3, 14, 0));
    const appointment = await a.repo.appointments.create({
      professionalId: professional.id,
      serviceId: service.id,
      contactId: c.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    });
    // Agendado para daqui a 2 s: o opt-out chega antes de o worker pegar o job.
    const pending = await enqueue({
      tenantId: a.tenant.id,
      contactId: c.id,
      messageType: "appointment_confirmation",
      idempotencyKey: `appointment_confirmation:${appointment!.id}`,
      appointmentId: appointment!.id,
      scheduledFor: new Date(Date.now() + 2_000),
    });
    expect(pending.status).toBe("queued");
    await receive(a, from, "STOP");
    if (pending.status !== "queued") return;
    expect(await settle(a, pending.outboundMessageId)).toMatchObject({ status: "blocked", blockReason: "opt_out" });
    const confirmation = await confirmationOf(a, c.id);
    expect(confirmation.status).toBe("sent");
    // Só a confirmação saiu; a confirmação de agendamento, não.
    expect(sentTo(from)).toHaveLength(1);
  });

  it("confirmação enviada uma única vez, mesmo com webhook repetido, simultâneo e novo SAIR", async () => {
    const from = phone();
    const payload = inbound(a, from, "PARAR");
    // O provedor reenvia o mesmo evento 3 vezes ao mesmo tempo.
    const outcomes = await Promise.all(
      [1, 2, 3].map(() => processWhatsAppWebhook(fake, payload, undefined, enqueue)),
    );
    expect(outcomes.map((o) => o.results.processed).reduce((x, y) => x + y)).toBe(1);
    const c = await contactOf(a, from);
    const sent = await confirmationOf(a, c.id);
    expect(sent).toMatchObject({ status: "sent", channel: "whatsapp", idempotencyKey: optOutConfirmationKey(c.id) });
    expect((await contactOf(a, from)).optOutConfirmationSentAt).toEqual(sent.sentAt);

    // Reenvio depois do envio e outros pedidos de saída (eventos novos): nada mais sai.
    await processWhatsAppWebhook(fake, payload, undefined, enqueue);
    await receive(a, from, "sair");
    await receive(a, from, "Cancelar");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await outboundOf(a, c.id)).map((r) => [r.messageType, r.status])).toEqual([["optout_confirmation", "sent"]]);

    const messages = sentTo(from);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe(a.sessionId);
    // Texto montado do template `optout_confirmation` do tenant, gravado na conversa.
    const template = await a.repo.messageTemplates.getByType("optout_confirmation");
    const rendered = template.variations.map((v) =>
      v.replaceAll("{{nome}}", "Maria Lima").replaceAll("{{negocio}}", a.tenant.name),
    );
    expect(rendered).toContain(messages[0].text);
    const outboundInConversation = await prisma.message.count({
      where: { tenantId: a.tenant.id, direction: "outbound", externalId: messages[0].externalId },
    });
    expect(outboundInConversation).toBe(1);
  });

  it("nenhum proativo depois do opt-out: bloqueado com motivo, sem sendText e sem gastar o teto", async () => {
    const from = phone();
    await receive(a, from, "Sair");
    const c = await contactOf(a, from);
    await confirmationOf(a, c.id);
    const before = (await a.repo.sendCounter.getState())!.sentCount;

    // Com agendamento `confirmed` (regra b) e mensagem recente (regra a): o opt-out vence.
    const row = await proactive(a, c.id);
    expect(row).toMatchObject({ status: "blocked", blockReason: "opt_out", channel: null, sentAt: null });
    expect(sentTo(from)).toHaveLength(1);
    expect((await a.repo.sendCounter.getState())!.sentCount).toBe(before);
  });

  it("VOLTAR reativa: proativos voltam a sair, sem nova confirmação", async () => {
    const from = phone();
    await receive(a, from, "SAIR");
    const c = await contactOf(a, from);
    await confirmationOf(a, c.id);

    const outcome = await receive(a, from, "Voltar");
    expect(outcome.results.processed).toBe(1);
    expect((await contactOf(a, from)).optOut).toBe(false);

    const row = await proactive(a, c.id);
    expect(row.status).toBe("sent");
    // Confirmação do opt-out e a confirmação de agendamento; o VOLTAR não gera mensagem.
    expect(sentTo(from)).toHaveLength(2);
    expect((await outboundOf(a, c.id)).map((r) => r.messageType)).toEqual([
      "optout_confirmation",
      "appointment_confirmation",
    ]);
  });

  it("VOLTAR antes de a confirmação sair: a confirmação é bloqueada (not_opted_out)", async () => {
    const from = phone();
    const held: EnqueueInput[] = [];
    await receive(a, from, "sair", async (input) => {
      held.push(input);
      return { status: "rejected", reason: "contact_not_found" };
    });
    await receive(a, from, "VOLTAR");
    // A confirmação só chega à fila depois do VOLTAR (fila lenta, por exemplo).
    const result = await enqueue(held[0]);
    expect(result.status).toBe("queued");
    if (result.status !== "queued") return;
    expect(await settle(a, result.outboundMessageId)).toMatchObject({ status: "blocked", blockReason: "not_opted_out" });
    expect(sentTo(from)).toHaveLength(0);
    expect((await contactOf(a, from)).optOutConfirmationSentAt).toBeNull();
  });

  it("SAIR atrasado (entregue depois de um VOLTAR mais novo) não descadastra", async () => {
    const from = phone();
    const t0 = Date.now() - 60_000;
    const send = (text: string, at: number) =>
      processWhatsAppWebhook(fake, inbound(a, from, text, { timestamp: new Date(at) } as Partial<FakeWebhookPayload>), undefined, enqueue);
    await send("VOLTAR", t0 + 10_000);
    await send("SAIR", t0);
    expect((await contactOf(a, from)).optOut).toBe(false);
    expect(await outboundOf(a, (await contactOf(a, from)).id)).toHaveLength(0);
  });

  it("frase com a palavra no meio não descadastra nem gera confirmação", async () => {
    const from = phone();
    for (const text of ["quero sair do horário das 15h", "Pode parar o lembrete?", "STOP!", "cancelar meu horário"]) {
      await receive(a, from, text);
    }
    const c = await contactOf(a, from);
    expect(c.optOut).toBe(false);
    expect(await outboundOf(a, c.id)).toHaveLength(0);
    expect(sentTo(from)).toHaveLength(0);
  });

  it("isolamento por tenant: o SAIR no número de A não afeta o mesmo telefone em B", async () => {
    const from = phone();
    await receive(b, from, "Oi");
    await receive(a, from, "Sair");
    const [inA, inB] = [await contactOf(a, from), await contactOf(b, from)];
    expect(inA.optOut).toBe(true);
    expect(inB.optOut).toBe(false);
    expect(inB.optOutConfirmationSentAt).toBeNull();

    const confirmation = await confirmationOf(a, inA.id);
    expect(confirmation.status).toBe("sent");
    expect(await outboundOf(b, inB.id)).toHaveLength(0);
    expect(sentTo(from).map((m) => m.sessionId)).toEqual([a.sessionId]);

    // B continua podendo enviar proativo para o seu contato.
    const row = await proactive(b, inB.id);
    expect(row.status).toBe("sent");
    expect(sentTo(from).map((m) => m.sessionId)).toEqual([a.sessionId, b.sessionId]);

    // O tenant B não alcança o contato de A pelo próprio repositório.
    expect(await b.repo.eligibility.findOptOutConfirmationFacts(inA.id)).toBeNull();
  });

  it("rota real POST /api/webhooks/whatsapp: SAIR responde 200 com opt_out gravado e a confirmação sai uma vez", async () => {
    const { call } = createRouteCaller({ "/api/webhooks/whatsapp": webhookRoute } as unknown as Record<string, RouteModule>);
    const ip = `10.77.${randomInt(256)}.${randomInt(1, 255)}`;
    usedIps.push(ip);
    const from = phone();
    const body = inbound(a, from, " Sáir ");
    const post = () =>
      call("POST", "/api/webhooks/whatsapp", { body, headers: { "x-forwarded-for": ip, [WEBHOOK_SECRET_HEADER]: SECRET } });

    const first = await post();
    expect(first.status).toBe(200);
    const c = await contactOf(a, from);
    expect(c.optOut).toBe(true);
    // Reenvio do provedor: 200, sem efeito novo.
    expect((await post()).status).toBe(200);

    const confirmation = await confirmationOf(a, c.id);
    expect(confirmation.status).toBe("sent");
    expect(sentTo(from)).toHaveLength(1);
  });
});
