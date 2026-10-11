import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Contact, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  createTenantRepository,
  SessionIdTakenError,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";
import {
  contactNameFrom,
  createWhatsAppWebhookRepository,
} from "@/server/repositories/whatsapp-webhook-repository";
import {
  FakeProvider,
  type FakeWebhookPayload,
  type InboundMessage,
  type WhatsAppEvent,
} from "@/server/whatsapp";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 4: repositórios do WhatsApp (guia 5, 6, 9; D1, D3, D8, D12). Isolamento por tenant
// (inclusive por ID) em conexão, conversa e mensagem, e o repositório do webhook: tenant só pelo
// sessionId, evento repetido grava uma vez, sessão desconhecida não altera nada, last_inbound_at.
// Os eventos saem do FakeProvider (o mesmo normalizador que a rota do webhook vai usar).

const fake = new FakeProvider();
const webhook = createWhatsAppWebhookRepository();

let tenantA: Tenant;
let tenantB: Tenant;
let tenantC: Tenant; // paginação
let repoA: TenantRepository;
let repoB: TenantRepository;
let repoC: TenantRepository;

const sessionA = `sess-a-${randomUUID()}`;
const sessionB = `sess-b-${randomUUID()}`;
const sessionC = `sess-c-${randomUUID()}`;

// Mesmo telefone escreve para os dois negócios.
const SHARED_PHONE = "+5511955550000";
let contactA: Contact; // já existia (agendamento com consentimento) antes de escrever pelo WhatsApp

const uid = () => randomUUID();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function event(payload: FakeWebhookPayload): Promise<WhatsAppEvent> {
  const [normalized] = await fake.handleWebhook(payload);
  return normalized;
}

function inbound(sessionId: string, input: Partial<Extract<FakeWebhookPayload, { type: "message" }>> = {}) {
  return event({
    type: "message",
    sessionId,
    messageId: `msg-${uid()}`,
    from: SHARED_PHONE,
    profileName: "Cliente do Zap",
    text: "Oi, tem horário amanhã?",
    timestamp: minutesAgo(1),
    ...input,
  }) as Promise<InboundMessage>;
}

// Foto de tudo que o webhook pode tocar, para provar que nada mudou.
async function snapshot() {
  const tenantIds = [tenantA.id, tenantB.id, tenantC.id];
  const where = { tenantId: { in: tenantIds } };
  const [contacts, conversations, messages, events, connections] = await Promise.all([
    prisma.contact.findMany({ where, orderBy: { id: "asc" } }),
    prisma.conversation.findMany({ where, orderBy: { id: "asc" } }),
    prisma.message.findMany({ where, orderBy: { id: "asc" } }),
    prisma.webhookEvent.findMany({ where, orderBy: { id: "asc" } }),
    prisma.whatsAppConnection.findMany({ where, orderBy: { id: "asc" } }),
  ]);
  return { contacts, conversations, messages, events, connections };
}

beforeAll(async () => {
  [tenantA, tenantB, tenantC] = await Promise.all([
    createTestTenant("wa-a"),
    createTestTenant("wa-b"),
    createTestTenant("wa-c"),
  ]);
  repoA = createTenantRepository(tenantA.id);
  repoB = createTenantRepository(tenantB.id);
  repoC = createTenantRepository(tenantC.id);
  await Promise.all([
    repoA.whatsappConnection.save({ sessionId: sessionA, status: "connected" }),
    repoB.whatsappConnection.save({ sessionId: sessionB, status: "connected" }),
    repoC.whatsappConnection.save({ sessionId: sessionC, status: "connected" }),
  ]);
  contactA = await repoA.contacts.findOrCreateByPhone(
    { name: "Carla Agendada", phone: SHARED_PHONE },
    { source: "public_booking", at: minutesAgo(600) },
  );
});

afterAll(async () => {
  await deleteTestTenants(tenantA, tenantB, tenantC);
  await prisma.$disconnect();
});

describe("conexão do WhatsApp por tenant", () => {
  it("cria, lê, troca a sessão e o estado só do próprio tenant", async () => {
    const tenant = await createTestTenant("wa-conn");
    try {
      const repo = createTenantRepository(tenant.id);
      expect(await repo.whatsappConnection.get()).toBeNull();
      expect(await repo.whatsappConnection.setStatus("connected")).toBeNull();

      const first = await repo.whatsappConnection.save({ sessionId: `s-${uid()}`, status: "qr_pending" });
      expect(first).toMatchObject({ tenantId: tenant.id, status: "qr_pending" });
      expect(first.lastCheckedAt).toBeInstanceOf(Date);

      const nextSession = `s-${uid()}`;
      const second = await repo.whatsappConnection.save({ sessionId: nextSession, status: "connected" });
      expect(second.id).toBe(first.id); // continua uma por tenant
      expect(second.sessionId).toBe(nextSession);

      const checkedAt = new Date("2031-01-01T00:00:00Z");
      const third = await repo.whatsappConnection.setStatus("disconnected", checkedAt);
      expect(third).toMatchObject({ id: first.id, status: "disconnected", lastCheckedAt: checkedAt });
      expect(await prisma.whatsAppConnection.count({ where: { tenantId: tenant.id } })).toBe(1);
    } finally {
      await deleteTestTenants(tenant);
    }
  });

  it("cada tenant lê só a própria conexão", async () => {
    expect((await repoA.whatsappConnection.get())?.sessionId).toBe(sessionA);
    expect((await repoB.whatsappConnection.get())?.sessionId).toBe(sessionB);
  });

  it("tenant A não assume a sessão do B (por ID da sessão) e nada do B muda", async () => {
    const before = await snapshot();
    await expect(
      repoA.whatsappConnection.save({ sessionId: sessionB, status: "connected" }),
    ).rejects.toBeInstanceOf(SessionIdTakenError);
    expect(await snapshot()).toEqual(before);
    expect(await webhook.resolveTenantId(sessionB)).toBe(tenantB.id);
  });

  it("setStatus do A não toca a conexão do B; entrada inválida é recusada", async () => {
    const beforeB = await repoB.whatsappConnection.get();
    await repoA.whatsappConnection.setStatus("connected");
    expect(await repoB.whatsappConnection.get()).toEqual(beforeB);

    await expect(repoA.whatsappConnection.setStatus("online" as never)).rejects.toBeInstanceOf(ZodError);
    await expect(repoA.whatsappConnection.save({ sessionId: "", status: "connected" })).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it("tenantId injetado na entrada é ignorado", async () => {
    const injected = { sessionId: sessionA, status: "connected", tenantId: tenantB.id } as never;
    const saved = await repoA.whatsappConnection.save(injected);
    expect(saved.tenantId).toBe(tenantA.id);
  });
});

describe("webhook: mensagem recebida", () => {
  it("contato novo: nome do perfil, origem whatsapp_inbound, sem consentimento (D12)", async () => {
    const phone = "+5511966661111";
    const message = await inbound(sessionB, { from: "(11) 96666-1111", profileName: "  Joana   Lima " });

    expect(await webhook.recordEvent(fake.source, message)).toEqual({
      status: "processed",
      tenantId: tenantB.id,
    });

    const contact = await repoB.contacts.findByPhone(phone);
    expect(contact).toMatchObject({
      tenantId: tenantB.id,
      name: "Joana Lima",
      consentAt: null,
      consentSource: "whatsapp_inbound",
      optOut: false,
      lastInboundAt: message.receivedAt,
    });
    // Nada no tenant A com esse telefone.
    expect(await repoA.contacts.findByPhone(phone)).toBeNull();

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { tenantId_contactId: { tenantId: tenantB.id, contactId: contact!.id } },
    });
    expect(conversation.lastMessageAt).toEqual(message.receivedAt);
    const messages = await repoB.messages.listByConversation(conversation.id);
    expect(messages?.items).toEqual([
      expect.objectContaining({
        direction: "inbound",
        status: "received",
        body: message.text,
        mediaType: null,
        sentAt: message.receivedAt,
      }),
    ]);
    const stored = await prisma.webhookEvent.findUniqueOrThrow({
      where: { source_eventId: { source: "fake", eventId: message.eventId } },
    });
    expect(stored.tenantId).toBe(tenantB.id);
    expect(stored.processedAt).toBeInstanceOf(Date);
  });

  it("sem nome do perfil, o contato recebe o telefone formatado; mídia guarda só o tipo", async () => {
    const message = await inbound(sessionB, {
      from: "+5511966662222",
      profileName: null,
      text: null,
      mediaType: "image",
    });
    await webhook.recordEvent(fake.source, message);
    const contact = await repoB.contacts.findByPhone("+5511966662222");
    expect(contact?.name).toBe("(11) 96666-2222");
    const row = await prisma.message.findFirstOrThrow({
      where: { tenantId: tenantB.id, externalId: message.externalId },
    });
    expect(row).toMatchObject({ body: null, mediaType: "image" });
  });

  it("contato existente: atualiza last_inbound_at sem trocar nome nem consentimento", async () => {
    const first = await inbound(sessionA, { timestamp: minutesAgo(30) });
    await webhook.recordEvent(fake.source, first);
    const afterFirst = await repoA.contacts.findById(contactA.id);
    expect(afterFirst).toMatchObject({
      name: "Carla Agendada",
      consentSource: "public_booking",
      consentAt: contactA.consentAt,
      lastInboundAt: first.receivedAt,
    });

    const second = await inbound(sessionA, { timestamp: minutesAgo(5) });
    await webhook.recordEvent(fake.source, second);
    expect((await repoA.contacts.findById(contactA.id))?.lastInboundAt).toEqual(second.receivedAt);

    // Evento atrasado (mais antigo) entra na conversa, mas não faz last_inbound_at voltar.
    const late = await inbound(sessionA, { timestamp: minutesAgo(20) });
    expect((await webhook.recordEvent(fake.source, late)).status).toBe("processed");
    expect((await repoA.contacts.findById(contactA.id))?.lastInboundAt).toEqual(second.receivedAt);

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { tenantId_contactId: { tenantId: tenantA.id, contactId: contactA.id } },
    });
    expect(conversation.lastMessageAt).toEqual(second.receivedAt);
    const page = await repoA.messages.listByConversation(conversation.id);
    expect(page?.items.map((m) => m.sentAt)).toEqual([
      second.receivedAt,
      late.receivedAt,
      first.receivedAt,
    ]);
    // Uma conversa por contato.
    expect(await prisma.conversation.count({ where: { tenantId: tenantA.id, contactId: contactA.id } })).toBe(1);
  });

  it("horário futuro do provedor não estende last_inbound_at além de agora", async () => {
    const future = await inbound(sessionA, { timestamp: new Date(Date.now() + 365 * 86_400_000) });
    const before = Date.now();
    await webhook.recordEvent(fake.source, future);
    const lastInboundAt = (await repoA.contacts.findById(contactA.id))!.lastInboundAt!;
    expect(lastInboundAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(lastInboundAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("o mesmo telefone em sessões diferentes grava no tenant de cada sessão", async () => {
    const toB = await inbound(sessionB, { profileName: "Carla no B" });
    expect(await webhook.recordEvent(fake.source, toB)).toEqual({ status: "processed", tenantId: tenantB.id });
    const contactB = await repoB.contacts.findByPhone(SHARED_PHONE);
    expect(contactB).toMatchObject({ tenantId: tenantB.id, name: "Carla no B" });
    expect(contactB!.id).not.toBe(contactA.id);
    expect((await repoA.contacts.findById(contactA.id))?.name).toBe("Carla Agendada");
  });
});

describe("webhook: idempotência e sessão desconhecida", () => {
  it("evento repetido grava uma única vez", async () => {
    const message = await inbound(sessionA);
    expect((await webhook.recordEvent(fake.source, message)).status).toBe("processed");
    const before = await snapshot();
    expect(await webhook.recordEvent(fake.source, message)).toEqual({ status: "duplicate" });
    expect(await snapshot()).toEqual(before);
  });

  it("reenvios simultâneos: um processa, os outros são duplicados", async () => {
    const message = await inbound(sessionB, { from: "+5511966663333" });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => webhook.recordEvent(fake.source, message)),
    );
    expect(results.filter((r) => r.status === "processed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(3);
    expect(await prisma.message.count({ where: { externalId: message.externalId } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { eventId: message.eventId } })).toBe(1);
    expect(await prisma.contact.count({ where: { phone: "+5511966663333" } })).toBe(1);
  });

  it("mesma mensagem com outro id de evento não duplica a mensagem", async () => {
    const message = await inbound(sessionA);
    await webhook.recordEvent(fake.source, message);
    const resent = { ...message, eventId: `${message.eventId}:retry` };
    expect((await webhook.recordEvent(fake.source, resent)).status).toBe("processed");
    expect(await prisma.message.count({ where: { tenantId: tenantA.id, externalId: message.externalId } })).toBe(1);
  });

  it("sessionId desconhecido não altera nada em nenhum tenant", async () => {
    const before = await snapshot();
    // Telefone novo a cada execução: a contagem é global (em qualquer tenant).
    const phone = `+551196${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const events = [
      await inbound(`sess-desconhecida-${uid()}`, { from: phone }),
      await event({ type: "connection", sessionId: `x-${uid()}`, state: "banned_suspected" }),
      await event({ type: "delivery", sessionId: `x-${uid()}`, messageId: `m-${uid()}`, state: "read" }),
    ];
    for (const unknown of events) {
      expect(await webhook.recordEvent(fake.source, unknown)).toEqual({ status: "unknown_session" });
      expect(await prisma.webhookEvent.count({ where: { eventId: unknown.eventId } })).toBe(0);
    }
    expect(await prisma.contact.count({ where: { phone } })).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(await webhook.resolveTenantId(`nope-${uid()}`)).toBeNull();
    expect(await webhook.resolveTenantId("")).toBeNull();
  });

  it("evento fora do contrato é recusado sem gravar", async () => {
    const before = await snapshot();
    const valid = await inbound(sessionA);
    const invalid = [
      { ...valid, from: "11999998888" },
      { ...valid, text: null, mediaType: null },
      { ...valid, eventId: "" },
    ];
    for (const bad of invalid) {
      await expect(webhook.recordEvent(fake.source, bad)).rejects.toBeInstanceOf(ZodError);
    }
    await expect(webhook.recordEvent("Fake!", valid)).rejects.toBeInstanceOf(ZodError);
    expect(await snapshot()).toEqual(before);
  });
});

describe("webhook: status de entrega e de conexão", () => {
  it("entrega só avança e só na mensagem do tenant da sessão", async () => {
    const externalId = `out-${uid()}`;
    const conversationOf = async (tenantId: string, contactId: string) =>
      (await prisma.conversation.findUniqueOrThrow({ where: { tenantId_contactId: { tenantId, contactId } } })).id;
    const contactB = (await repoB.contacts.findByPhone(SHARED_PHONE))!;
    // Mesmo id externo nos dois tenants (único só por tenant).
    for (const [tenantId, contactId] of [
      [tenantA.id, contactA.id],
      [tenantB.id, contactB.id],
    ]) {
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: await conversationOf(tenantId, contactId),
          direction: "outbound",
          status: "pending",
          body: "Lembrete",
          externalId,
          sentAt: new Date(),
        },
      });
    }
    const statusOf = async (tenantId: string) =>
      (await prisma.message.findFirstOrThrow({ where: { tenantId, externalId } })).status;

    const delivered = await event({ type: "delivery", sessionId: sessionA, messageId: externalId, state: "delivered" });
    expect((await webhook.recordEvent(fake.source, delivered)).status).toBe("processed");
    expect(await statusOf(tenantA.id)).toBe("delivered");
    expect(await statusOf(tenantB.id)).toBe("pending");

    const lateSent = await event({ type: "delivery", sessionId: sessionA, messageId: externalId, state: "sent" });
    await webhook.recordEvent(fake.source, lateSent);
    expect(await statusOf(tenantA.id)).toBe("delivered");

    const failed = await event({ type: "delivery", sessionId: sessionA, messageId: externalId, state: "failed" });
    await webhook.recordEvent(fake.source, failed);
    expect(await statusOf(tenantA.id)).toBe("delivered");
  });

  it("status de conexão muda só a conexão da sessão; evento antigo não sobrescreve", async () => {
    const beforeB = await repoB.whatsappConnection.get();
    const dropped = await event({
      type: "connection",
      sessionId: sessionA,
      state: "disconnected",
      reason: "logged_out",
      timestamp: new Date(),
    });
    expect((await webhook.recordEvent(fake.source, dropped)).status).toBe("processed");
    expect((await repoA.whatsappConnection.get())?.status).toBe("disconnected");
    expect(await repoB.whatsappConnection.get()).toEqual(beforeB);

    const stale = await event({
      type: "connection",
      sessionId: sessionA,
      state: "connected",
      timestamp: minutesAgo(60),
    });
    expect((await webhook.recordEvent(fake.source, stale)).status).toBe("processed");
    expect((await repoA.whatsappConnection.get())?.status).toBe("disconnected");
    await repoA.whatsappConnection.setStatus("connected");
  });
});

describe("conversas e mensagens: isolamento por tenant", () => {
  let conversationA: string;
  let conversationB: string;

  beforeAll(async () => {
    conversationA = (
      await prisma.conversation.findUniqueOrThrow({
        where: { tenantId_contactId: { tenantId: tenantA.id, contactId: contactA.id } },
      })
    ).id;
    const contactB = (await repoB.contacts.findByPhone(SHARED_PHONE))!;
    conversationB = (
      await prisma.conversation.findUniqueOrThrow({
        where: { tenantId_contactId: { tenantId: tenantB.id, contactId: contactB.id } },
      })
    ).id;
  });

  it("a lista de cada tenant só tem as próprias conversas, com contato e última mensagem", async () => {
    const [listA, listB] = await Promise.all([repoA.conversations.list(), repoB.conversations.list()]);
    const idsA = listA.items.map((c) => c.id);
    const idsB = listB.items.map((c) => c.id);
    expect(idsA).toContain(conversationA);
    expect(idsA).not.toContain(conversationB);
    expect(idsB).toContain(conversationB);
    expect(idsB).not.toContain(conversationA);

    const rowsA = await prisma.conversation.findMany({ where: { id: { in: idsA } }, select: { tenantId: true } });
    expect(rowsA.every((row) => row.tenantId === tenantA.id)).toBe(true);

    const summary = listA.items.find((c) => c.id === conversationA)!;
    expect(summary.contact).toEqual({ id: contactA.id, name: "Carla Agendada", phone: SHARED_PHONE });
    expect(summary.lastMessage).not.toBeNull();
    // Ordem: última mensagem mais recente primeiro.
    const times = listB.items.map((c) => c.lastMessageAt?.getTime() ?? 0);
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it("busca por ID de outro tenant retorna null; o dono enxerga", async () => {
    expect(await repoA.conversations.findById(conversationB)).toBeNull();
    expect(await repoA.messages.listByConversation(conversationB)).toBeNull();
    expect(await repoB.conversations.findById(conversationA)).toBeNull();
    expect(await repoB.messages.listByConversation(conversationA)).toBeNull();

    expect((await repoB.conversations.findById(conversationB))?.id).toBe(conversationB);
    expect((await repoB.messages.listByConversation(conversationB))?.items.length).toBeGreaterThan(0);
  });

  it("ID malformado ou inexistente se comporta como inexistente", async () => {
    expect(await repoA.conversations.findById("nao-e-uuid")).toBeNull();
    expect(await repoA.conversations.findById("1 or 1=1")).toBeNull();
    expect(await repoA.messages.listByConversation("")).toBeNull();
    expect(await repoA.messages.listByConversation(randomUUID())).toBeNull();
  });

  it("mensagens do A nunca aparecem na conversa do B", async () => {
    const pageB = await repoB.messages.listByConversation(conversationB);
    const ids = pageB!.items.map((m) => m.id);
    const rows = await prisma.message.findMany({ where: { id: { in: ids } }, select: { tenantId: true } });
    expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
  });
});

describe("paginação de 50", () => {
  let conversationId: string;
  const base = Date.UTC(2031, 0, 1);

  beforeAll(async () => {
    // 51 contatos e conversas, e 120 mensagens numa delas, direto no banco (fixture).
    const contacts = await Promise.all(
      Array.from({ length: 51 }, (_, i) =>
        repoC.contacts.findOrCreateByPhone({ name: `Cliente ${i}`, phone: `+55119700${String(i).padStart(5, "0")}` }),
      ),
    );
    await prisma.conversation.createMany({
      data: contacts.map((contact, i) => ({
        tenantId: tenantC.id,
        contactId: contact.id,
        lastMessageAt: new Date(base + i * 60_000),
      })),
    });
    conversationId = (
      await prisma.conversation.findUniqueOrThrow({
        where: { tenantId_contactId: { tenantId: tenantC.id, contactId: contacts[50].id } },
      })
    ).id;
    await prisma.message.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        tenantId: tenantC.id,
        conversationId,
        direction: "inbound",
        status: "received",
        body: `Mensagem ${i}`,
        externalId: `pag-${uid()}`,
        sentAt: new Date(base + i * 1000),
      })),
    });
  });

  it("conversas: 50 por página, mais recente primeiro", async () => {
    const page1 = await repoC.conversations.list();
    expect(page1).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(page1.items).toHaveLength(50);
    expect(page1.items[0].id).toBe(conversationId);
    expect(page1.items[0].lastMessage?.body).toBe("Mensagem 119");

    const page2 = await repoC.conversations.list(2);
    expect(page2).toMatchObject({ page: 2, hasMore: false });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].lastMessage).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((c) => c.id)).size).toBe(51);
  });

  it("mensagens: 50 por página, sem repetir nem pular", async () => {
    const pages = await Promise.all([1, 2, 3, 4].map((n) => repoC.messages.listByConversation(conversationId, n)));
    expect(pages.map((p) => p!.items.length)).toEqual([50, 50, 20, 0]);
    expect(pages.map((p) => p!.hasMore)).toEqual([true, true, false, false]);
    expect(pages[0]!.items[0].body).toBe("Mensagem 119");
    expect(pages[2]!.items.at(-1)!.body).toBe("Mensagem 0");
    const bodies = pages.flatMap((p) => p!.items.map((m) => m.body));
    expect(new Set(bodies).size).toBe(120);
  });

  it("página inválida é recusada", async () => {
    await expect(repoC.conversations.list(0)).rejects.toBeInstanceOf(ZodError);
    await expect(repoC.messages.listByConversation(conversationId, 1.5)).rejects.toBeInstanceOf(ZodError);
    // Outro tenant na mesma página: nada.
    expect(await repoA.messages.listByConversation(conversationId, 1)).toBeNull();
  });
});

describe("nome do contato a partir do perfil (D12)", () => {
  it.each([
    ["Joana", "Joana"],
    ["  Ana\u0000​  Paula\n", "Ana Paula"],
    ["J", "(11) 98765-4321"],
    [null, "(11) 98765-4321"],
    ["   ", "(11) 98765-4321"],
    ["x".repeat(200), "x".repeat(80)],
    ["Zé 😀", "Zé 😀"],
  ])("%j → %j", (profile, expected) => {
    expect(contactNameFrom(profile, "+5511987654321")).toBe(expected);
  });

  it("telefone de fora do Brasil fica em E.164", () => {
    expect(contactNameFrom(null, "+14155552671")).toBe("+14155552671");
  });
});
