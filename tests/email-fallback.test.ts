import { randomUUID } from "node:crypto";
import { QueueEvents, type Queue, type Worker } from "bullmq";
import type { Redis } from "ioredis";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Contact, OutboundMessage, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { EmailProviderError, FakeEmailProvider, type EmailProvider, type SendEmailInput } from "@/server/email";
import { enqueueMessage } from "@/server/outbound/enqueue";
import { createOutboundQueue, type OutboundJobData } from "@/server/outbound/queue";
import { createOutboundWorker, type SendOutcome } from "@/server/outbound/worker";
import { createProducerConnection, createWorkerConnection } from "@/server/queue/connection";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import { FakeProvider, type ConnectionState } from "@/server/whatsapp";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 8: fallback por e-mail (guia 6, 7d; D8), de ponta a ponta com o Redis local dos testes, a
// branch test do Neon, o FakeProvider do WhatsApp e o FakeEmailProvider. O relógio do worker fica
// no meio-dia de São Paulo (janela das 8h às 20h aberta, D11), como no teste de opt-out.

const testRedisUrl = process.env.TEST_REDIS_URL as string;
const prefix = `test-email-${randomUUID().slice(0, 8)}`;
const WAIT_MS = 15_000;
const FROM_DOMAIN = "envio.slotz-teste.dev";

const noonOffsetMs = (() => {
  const real = DateTime.now().setZone("America/Sao_Paulo");
  return real.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toMillis() - real.toMillis();
})();
const workerNow = () => new Date(Date.now() + noonOffsetMs);

const whatsapp = new FakeProvider();
const fakeEmail = new FakeEmailProvider();
// Falhas simuladas do provedor de e-mail, antes de chegar ao Fake.
let unavailableLeft = 0;
let rejectNext = false;
const emailCalls: SendEmailInput[] = [];
const email: EmailProvider = {
  source: "fake",
  send: async (input) => {
    emailCalls.push(input);
    if (rejectNext) {
      rejectNext = false;
      throw new EmailProviderError("rejected", "Destinatário recusado (simulado).");
    }
    if (unavailableLeft > 0) {
      unavailableLeft -= 1;
      throw new EmailProviderError("provider_unavailable", "Provedor fora do ar (simulado).");
    }
    return fakeEmail.send(input);
  },
};

let workerConnection: Redis;
let producerConnection: Redis;
let queue: Queue<OutboundJobData>;
let events: QueueEvents;
let worker: Worker<OutboundJobData, SendOutcome>;
const logs: { event: string; fields: Record<string, unknown> }[] = [];

interface Scenario {
  tenant: Tenant;
  repo: TenantRepository;
  sessionId: string | null;
  professionalId: string;
  serviceId: string;
}
const tenants: Tenant[] = [];
let hour = 0;

const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const sentTo = (to: string) => whatsapp.sentMessages.filter((m) => m.to === to);
const emailsTo = (to: string) => fakeEmail.sentEmails.filter((m) => m.to === to);

// Tenant com a conexão do WhatsApp no estado pedido (null = nunca conectou).
async function scenario(label: string, status: ConnectionState | null): Promise<Scenario> {
  const tenant = await createTestTenant(label);
  tenants.push(tenant);
  const repo = createTenantRepository(tenant.id);
  let sessionId: string | null = null;
  if (status) {
    ({ sessionId } = await whatsapp.connect());
    await whatsapp.simulateQrScan(sessionId);
    await repo.whatsappConnection.save({ sessionId, status: "connected" });
    if (status !== "connected") await repo.whatsappConnection.setStatus(status);
  }
  const professional = await repo.professionals.create({ name: "Ana Souza" });
  const service = await repo.services.create({ name: "Corte de cabelo", durationMinutes: 30, priceCents: 5000 });
  return { tenant, repo, sessionId, professionalId: professional.id, serviceId: service.id };
}

async function contact(s: Scenario, data: Partial<Contact> = {}): Promise<Contact> {
  const created = await s.repo.contacts.findOrCreateByPhone({ name: "Maria Lima", phone: phone() });
  return prisma.contact.update({ where: { id: created.id }, data });
}

const newEmail = () => `maria.${randomUUID().slice(0, 8)}@cliente.dev`;

// Contato com e-mail (salvo `email: null`) e agendamento `confirmed` (regra b), e o envio da
// confirmação do agendamento.
async function confirmation(s: Scenario, data: Partial<Contact> = {}, extra: { scheduledFor?: Date } = {}) {
  const c = await contact(s, { email: newEmail(), ...data });
  const startsAt = new Date(Date.UTC(2027, 1, 5, 13 + (hour % 8), 0) + Math.floor(hour++ / 8) * 86_400_000);
  const appointment = await s.repo.appointments.create({
    professionalId: s.professionalId,
    serviceId: s.serviceId,
    contactId: c.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
  });
  if (!appointment) throw new Error("agendamento de teste não criado");
  const input = {
    tenantId: s.tenant.id,
    contactId: c.id,
    messageType: "appointment_confirmation" as const,
    idempotencyKey: `appointment_confirmation:${appointment.id}`,
    appointmentId: appointment.id,
    ...extra,
  };
  return { contact: c, appointmentId: appointment.id, input };
}

async function enqueue(input: Parameters<typeof enqueueMessage>[0]): Promise<string> {
  const result = await enqueueMessage(input, { queue });
  if (result.status !== "queued") throw new Error(`enqueue: ${result.status}`);
  return result.outboundMessageId;
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

async function conversationMessages(s: Scenario, contactId: string): Promise<number> {
  return prisma.message.count({ where: { tenantId: s.tenant.id, conversation: { contactId } } });
}

const dailyCount = async (s: Scenario) => (await s.repo.sendCounter.getState())?.sentCount ?? 0;

beforeAll(async () => {
  workerConnection = createWorkerConnection(testRedisUrl);
  producerConnection = createProducerConnection(testRedisUrl);
  queue = createOutboundQueue(producerConnection, { prefix });
  events = new QueueEvents("outbound", { connection: createWorkerConnection(testRedisUrl), prefix });
  worker = createOutboundWorker({
    connection: workerConnection,
    prefix,
    provider: whatsapp,
    email,
    emailFromDomain: FROM_DOMAIN,
    now: workerNow,
    retryDelaysMs: [100, 200, 300],
    nextSendAt: (sentAt) => new Date(sentAt.getTime() + 50),
    lockRetryMs: 100,
    log: (event, fields = {}) => logs.push({ event, fields }),
  });
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
}, 60_000);

afterAll(async () => {
  await worker?.close();
  await events?.close();
  await queue?.obliterate({ force: true }).catch(() => {});
  await queue?.close();
  await Promise.all([workerConnection, producerConnection].map((c) => c?.quit().catch(() => c.disconnect())));
  await deleteTestTenants(...tenants);
}, 60_000);

beforeEach(() => {
  unavailableLeft = 0;
  rejectNext = false;
});

describe("WhatsApp caído envia por e-mail (guia 7d)", () => {
  let down: Scenario;
  beforeAll(async () => {
    down = await scenario("caido", "disconnected");
  });

  it("conexão disconnected: sai por e-mail, registra sent/email, sem sendText, sem teto e fora da conversa", async () => {
    const { contact: c, input } = await confirmation(down);
    const id = await enqueue(input);
    const row = await settle(down, id);

    expect(row).toMatchObject({ status: "sent", channel: "email", blockReason: null });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.templateVariant).toBeGreaterThanOrEqual(0);
    const [sent, ...rest] = emailsTo(c.email!);
    expect(rest).toEqual([]);
    expect(row.externalId).toBe(sent.externalId);
    expect(sent.from).toBe(`"${down.tenant.name}" <nao-responda@${FROM_DOMAIN}>`);
    expect(sent.subject).toBe(`Agendamento confirmado - ${down.tenant.name}`);
    expect(sent.idempotencyKey).toBe(`outbound:${id}`);
    // Corpo = variação do template do tenant (o mesmo do WhatsApp), montado no worker.
    for (const part of ["Maria Lima", "Corte de cabelo", "Ana Souza"]) expect(sent.text).toContain(part);
    expect(sent.text).toMatch(/\d{2}\/\d{2}\/2027/);
    // Corpo = uma variação do template do tenant (o mesmo do WhatsApp), em texto puro.
    const template = await down.repo.messageTemplates.getByType("appointment_confirmation");
    const head = template.variations[row.templateVariant!].split("{{")[0];
    expect(sent.text.startsWith(head)).toBe(true);
    expect(sent.text).not.toContain("{{");

    expect(sentTo(c.phone)).toEqual([]);
    expect(await dailyCount(down)).toBe(0);
    expect(await conversationMessages(down, c.id)).toBe(0);
  });

  it("banned_suspected e tenant sem conexão também usam o e-mail", async () => {
    const banned = await scenario("banido", "banned_suspected");
    const never = await scenario("semconexao", null);
    const a = await confirmation(banned);
    const b = await confirmation(never);
    const rows = await Promise.all([
      enqueue(a.input).then((id) => settle(banned, id)),
      enqueue(b.input).then((id) => settle(never, id)),
    ]);
    expect(rows.map((r) => [r.status, r.channel])).toEqual([
      ["sent", "email"],
      ["sent", "email"],
    ]);
    expect(emailsTo(a.contact.email!)).toHaveLength(1);
    expect(emailsTo(b.contact.email!)).toHaveLength(1);
    expect([...sentTo(a.contact.phone), ...sentTo(b.contact.phone)]).toEqual([]);
  });

  it("conexão connected continua no WhatsApp, mesmo com o contato tendo e-mail", async () => {
    const up = await scenario("conectado", "connected");
    const { contact: c, input } = await confirmation(up);
    const row = await settle(up, await enqueue(input));
    expect([row.status, row.channel]).toEqual(["sent", "whatsapp"]);
    expect(sentTo(c.phone)).toHaveLength(1);
    expect(emailsTo(c.email!)).toEqual([]);
    expect(await dailyCount(up)).toBe(1);
  });

  it("retentativa por e-mail: falha temporária e sucesso enviam uma vez, com a mesma chave e o mesmo conteúdo", async () => {
    unavailableLeft = 2;
    const { contact: c, input } = await confirmation(down);
    const id = await enqueue(input);
    const row = await settle(down, id);
    expect([row.status, row.channel]).toEqual(["sent", "email"]);
    expect(emailsTo(c.email!)).toHaveLength(1);
    const calls = emailCalls.filter((call) => call.to === c.email);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.idempotencyKey))).toEqual(new Set([`outbound:${id}`]));
    expect(new Set(calls.map((call) => call.text)).size).toBe(1);
    const failures = logs.filter((l) => l.event === "outbound_attempt_failed" && l.fields.outboundMessageId === id);
    expect(failures.map((l) => l.fields.error)).toEqual(["provider_unavailable", "provider_unavailable"]);
  });

  it("destinatário recusado pelo provedor: failed na hora, sem retentativa", async () => {
    rejectNext = true;
    const { contact: c, input } = await confirmation(down);
    const id = await enqueue(input);
    const row = await settle(down, id);
    expect(row.status).toBe("failed");
    expect(emailCalls.filter((call) => call.to === c.email)).toHaveLength(1);
    expect(emailsTo(c.email!)).toEqual([]);
    const deadline = Date.now() + WAIT_MS;
    while ((await (await queue.getJob(id))?.getState()) !== "failed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await queue.getJob(id))?.attemptsMade).toBe(1);
    expect(logs.some((l) => l.event === "outbound_email_rejected" && l.fields.outboundMessageId === id)).toBe(true);
  });

  it("expirado também no e-mail: mais de 24 h de atraso vira expired, sem envio", async () => {
    const { contact: c, input } = await confirmation(down, {}, {
      scheduledFor: new Date(workerNow().getTime() - 25 * 60 * 60 * 1000),
    });
    const row = await settle(down, await enqueue(input));
    expect(row.status).toBe("expired");
    expect(emailCalls.filter((call) => call.to === c.email)).toEqual([]);
  });

  it("log do worker sem e-mail, telefone nem texto", () => {
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toMatch(/@cliente\.dev|\+55119|Maria Lima|Corte de cabelo/);
  });
});

describe("sem canal (D8): WhatsApp fora e contato sem e-mail", () => {
  it("vira blocked com no_channel, sem envio por nenhum canal e sem nova tentativa", async () => {
    const down = await scenario("semcanal", "disconnected");
    const { contact: c, input } = await confirmation(down, { email: null });
    const callsBefore = emailCalls.length;
    const id = await enqueue(input);
    const row = await settle(down, id);
    expect([row.status, row.blockReason, row.channel, row.sentAt]).toEqual(["blocked", "no_channel", null, null]);
    expect(sentTo(c.phone)).toEqual([]);
    expect(emailCalls.length).toBe(callsBefore);
    expect(await (await queue.getJob(id))?.getState()).toBe("completed");
    expect((await queue.getJob(id))?.attemptsMade).toBe(1);
  });

  it("e-mail em branco conta como sem e-mail", async () => {
    const down = await scenario("embranco", "banned_suspected");
    const { input } = await confirmation(down, { email: "   " });
    const row = await settle(down, await enqueue(input));
    expect([row.status, row.blockReason]).toEqual(["blocked", "no_channel"]);
  });
});

describe("opt-out vale também no e-mail", () => {
  it("contato em opt-out com e-mail, agendamento e consentimento: blocked/opt_out, nenhum e-mail", async () => {
    const down = await scenario("optout", "disconnected");
    const { contact: c, input } = await confirmation(down, { optOut: true, consentAt: new Date() });
    const row = await settle(down, await enqueue(input));
    expect([row.status, row.blockReason, row.channel]).toEqual(["blocked", "opt_out", null]);
    expect(emailCalls.filter((call) => call.to === c.email)).toEqual([]);
    expect(sentTo(c.phone)).toEqual([]);
  });

  it("confirmação de opt-out para quem não saiu, com e-mail: blocked/not_opted_out, nenhum e-mail (elegibilidade antes do canal)", async () => {
    const down = await scenario("inelegivel", "disconnected");
    const c = await contact(down, { email: newEmail() });
    const row = await settle(
      down,
      await enqueue({
        tenantId: down.tenant.id,
        contactId: c.id,
        messageType: "optout_confirmation",
        idempotencyKey: `teste-email-inelegivel:${c.id}`,
      }),
    );
    expect([row.status, row.blockReason]).toEqual(["blocked", "not_opted_out"]);
    expect(emailCalls.filter((call) => call.to === c.email)).toEqual([]);
  });

  it("depois do SAIR, a confirmação única sai por e-mail se o WhatsApp caiu, e nada proativo depois", async () => {
    const down = await scenario("saiu", "disconnected");
    const { contact: c, input } = await confirmation(down, { optOut: true, lastInboundAt: workerNow() });
    const confirmationId = await enqueue({
      tenantId: down.tenant.id,
      contactId: c.id,
      messageType: "optout_confirmation",
      idempotencyKey: `optout_confirmation:${c.id}`,
    });
    const confirmationRow = await settle(down, confirmationId);
    expect([confirmationRow.status, confirmationRow.channel]).toEqual(["sent", "email"]);
    const [sent] = emailsTo(c.email!);
    expect(sent.subject).toBe(`Você não vai mais receber mensagens de ${down.tenant.name}`);
    // Marcador "nunca repetir" (D15) gravado também no envio por e-mail.
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.optOutConfirmationSentAt?.getTime()).toBe(confirmationRow.sentAt?.getTime());

    const proactive = await settle(down, await enqueue(input));
    expect([proactive.status, proactive.blockReason]).toEqual(["blocked", "opt_out"]);
    expect(emailsTo(c.email!)).toHaveLength(1);
  });
});

describe("isolamento por tenant", () => {
  it("o e-mail usa o contato e o nome do próprio tenant; B com o mesmo telefone e sem e-mail fica no_channel", async () => {
    const a = await scenario("iso-a", "disconnected");
    const b = await scenario("iso-b", "disconnected");
    const shared = phone();
    const ca = await a.repo.contacts.findOrCreateByPhone({ name: "Maria Lima", phone: shared, email: newEmail() });
    const cb = await b.repo.contacts.findOrCreateByPhone({ name: "Maria Lima", phone: shared });
    const make = async (s: Scenario, c: Contact) => {
      await prisma.contact.update({ where: { id: c.id }, data: { optOut: true, lastInboundAt: workerNow() } });
      return enqueue({
        tenantId: s.tenant.id,
        contactId: c.id,
        messageType: "optout_confirmation",
        idempotencyKey: `optout_confirmation:${c.id}`,
      });
    };
    const [ra, rb] = await Promise.all([
      make(a, ca).then((id) => settle(a, id)),
      make(b, cb).then((id) => settle(b, id)),
    ]);
    expect([ra.status, ra.channel]).toEqual(["sent", "email"]);
    expect([rb.status, rb.blockReason]).toEqual(["blocked", "no_channel"]);
    const sent = emailsTo(ca.email!);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toContain(a.tenant.name);
    expect(sent[0].text).not.toContain(b.tenant.name);
  });
});
