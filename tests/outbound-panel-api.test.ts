import { randomInt, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import * as usageRoute from "@/app/api/whatsapp/usage/route";
import * as blockedRoute from "@/app/api/whatsapp/blocked/route";
import * as templatesRoute from "@/app/api/message-templates/route";
import * as templateRoute from "@/app/api/message-templates/[id]/route";
import * as restoreRoute from "@/app/api/message-templates/[id]/restore/route";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { OUTBOUND_MESSAGE_TYPES } from "@/server/outbound/message-types";
import { tenantDay } from "@/server/outbound/send-policy";
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES } from "@/server/outbound/templates";
import { apiRequest, cleanupAuthData, sessionCookieOf, uniqueEmail } from "./helpers/auth";
import { createRouteCaller, type CallOptions, type Method, type RouteModule } from "./helpers/api-routes";

// Fase 9 (fila-envio-limites-elegibilidade): API do painel. Uso do dia, fase do aquecimento,
// bloqueios com motivo e templates (listar, ler, editar, restaurar o padrão), com Zod e o erro
// padrão. Isolamento: o tenant A é negado em todas as rotas do B, sem sessão nada passa e nenhuma
// rota aceita tenantId do cliente (guia 3, 5, 7f; D5, D6). Toda requisição passa pelo proxy de
// verdade antes do handler. Banco: branch test do Neon.

const PASSWORD = "senha-forte-123";
const DAY_MS = 24 * 60 * 60 * 1000;

const ROUTES = {
  "/api/whatsapp/usage": usageRoute,
  "/api/whatsapp/blocked": blockedRoute,
  "/api/message-templates": templatesRoute,
  "/api/message-templates/[id]": templateRoute,
  "/api/message-templates/[id]/restore": restoreRoute,
} as unknown as Record<string, RouteModule>;

// Todas as rotas da fase com o método; `:id` vira o ID de um template.
const PANEL_CALLS: [Method, string][] = [
  ["GET", "/api/whatsapp/usage"],
  ["GET", "/api/whatsapp/blocked"],
  ["GET", "/api/message-templates"],
  ["GET", "/api/message-templates/:id"],
  ["PATCH", "/api/message-templates/:id"],
  ["POST", "/api/message-templates/:id/restore"],
];

const { call } = createRouteCaller(ROUTES);

interface Account {
  token: string;
  tenantId: string;
}

async function register(businessName: string): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName, email: uniqueEmail("painel-envio"), password: PASSWORD },
    }),
  );
  expect(response.status).toBe(201);
  return { token: sessionCookieOf(response)!.value, tenantId: (await response.json()).tenant.id as string };
}

const panel = (account: Account, method: Method, path: string, options: CallOptions = {}) =>
  call(method, path, { token: account.token, ...options });

const phone = () => `+55119${randomInt(10_000_000, 99_999_999)}`;

const todayOf = async (tenantId: string): Promise<string> => {
  const { timezone } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return tenantDay(new Date(), timezone);
};

interface ConnectionSetup {
  firstConnectedAt: Date | null;
  sentCount?: number;
  countDate?: string | null;
  manualLimit?: number | null;
}

async function setConnection(tenantId: string, setup: ConnectionSetup) {
  const data = {
    status: "connected",
    firstConnectedAt: setup.firstConnectedAt,
    dailySentCount: setup.sentCount ?? 0,
    dailyCountDate: setup.countDate ? new Date(`${setup.countDate}T00:00:00Z`) : null,
    dailySendLimit: setup.manualLimit ?? null,
  };
  await prisma.whatsAppConnection.upsert({
    where: { tenantId },
    create: { tenantId, sessionId: `painel-${randomUUID()}`, ...data },
    update: data,
  });
}

async function createContact(tenantId: string, name: string) {
  return prisma.contact.create({ data: { tenantId, name, phone: phone() } });
}

let seq = 0;
async function createOutbound(
  tenantId: string,
  contactId: string,
  status: "blocked" | "queued" | "sent" | "expired",
  extra: { blockReason?: string; updatedAt?: Date } = {},
) {
  const sent = status === "sent";
  return prisma.outboundMessage.create({
    data: {
      tenantId,
      contactId,
      messageType: "appointment_confirmation",
      status,
      blockReason: status === "blocked" ? (extra.blockReason ?? "not_eligible") : null,
      idempotencyKey: `painel-${seq++}-${randomUUID()}`,
      channel: sent ? "whatsapp" : null,
      sentAt: sent ? new Date() : null,
      externalId: sent ? `ext-${randomUUID()}` : null,
      updatedAt: extra.updatedAt,
    },
  });
}

const templatesOf = (tenantId: string) =>
  prisma.messageTemplate.findMany({ where: { tenantId }, orderBy: { messageType: "asc" } });

const templateOf = (tenantId: string, messageType: string) =>
  prisma.messageTemplate.findUniqueOrThrow({ where: { tenantId_messageType: { tenantId, messageType } } });

// Foto de tudo o que as rotas da fase leem ou gravam para um tenant: nada pode mudar nos recusados.
async function snapshot(tenantId: string) {
  const [connection, templates, outbound] = await Promise.all([
    prisma.whatsAppConnection.findUnique({
      where: { tenantId },
      select: { firstConnectedAt: true, dailySentCount: true, dailyCountDate: true, dailySendLimit: true },
    }),
    prisma.messageTemplate.findMany({
      where: { tenantId },
      select: { id: true, variations: true, active: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.outboundMessage.findMany({
      where: { tenantId },
      select: { id: true, status: true, blockReason: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return { connection, templates, outbound };
}

let a: Account;
let b: Account;

beforeAll(async () => {
  [a, b] = await Promise.all([register("Studio A Envios"), register("Studio B Envios")]);
});

afterAll(async () => {
  await cleanupAuthData();
});

describe("cobertura", () => {
  it("ROUTES são exatamente as rotas de uso, bloqueios e templates em src/app/api", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[])
      .filter((file) => file.split(sep).at(-1) === "route.ts")
      .map((file) => ["/api", ...file.split(sep).slice(0, -1)].join("/"))
      .filter((route) =>
        ["/api/whatsapp/usage", "/api/whatsapp/blocked", "/api/message-templates"].some((p) => route.startsWith(p)),
      )
      .sort();
    expect(routes).toEqual(Object.keys(ROUTES).sort());
    // Toda rota com método está em PANEL_CALLS (que os testes de sessão e isolamento percorrem).
    const declared = Object.entries(ROUTES).flatMap(([pattern, module]) =>
      Object.keys(module)
        .filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(name))
        .map((method) => `${method} ${pattern.replace("[id]", ":id")}`),
    );
    expect(declared.sort()).toEqual(PANEL_CALLS.map(([method, path]) => `${method} ${path}`).sort());
  });
});

describe("sem sessão", () => {
  it("todas as rotas respondem 401 no formato padrão e nunca chegam ao handler", async () => {
    const { id } = await templateOf(b.tenantId, "appointment_confirmation");
    const before = await snapshot(b.tenantId);
    for (const token of [undefined, "token-invalido", randomUUID()]) {
      for (const [method, path] of PANEL_CALLS) {
        const result = await call(method, path.replace(":id", id), {
          token,
          headers: { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: randomUUID() },
          body: method === "GET" ? undefined : { variations: ["a", "b", "c"], tenantId: b.tenantId },
        });
        expect(result.status, `${method} ${path} ${token}`).toBe(401);
        expect(result.reachedHandler).toBe(false);
        expect(result.body.error).toEqual({ code: "unauthorized", message: expect.any(String) });
      }
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
});

describe("GET /api/whatsapp/usage", () => {
  it("sem conexão: não configurado, uso zero e aquecimento no dia 1 sem início", async () => {
    const result = await panel(a, "GET", "/api/whatsapp/usage");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.body.usage).toEqual({
      configured: false,
      day: await todayOf(a.tenantId),
      timezone: "America/Sao_Paulo",
      used: 0,
      limit: 20,
      manualLimit: null,
      warmup: {
        startedAt: null,
        day: 1,
        totalDays: 14,
        inWarmup: true,
        curveLimit: 20,
        matureLimit: 200,
        next: { day: 3, limit: 40 },
      },
    });
  });

  it("em aquecimento: uso de hoje, limite do degrau e próximo degrau", async () => {
    const firstConnectedAt = new Date(Date.now() - 3 * DAY_MS);
    await setConnection(b.tenantId, { firstConnectedAt, sentCount: 7, countDate: await todayOf(b.tenantId) });
    const { usage } = (await panel(b, "GET", "/api/whatsapp/usage")).body;
    expect(usage).toMatchObject({
      configured: true,
      used: 7,
      limit: 40,
      manualLimit: null,
      warmup: { startedAt: firstConnectedAt.toISOString(), day: 4, inWarmup: true, curveLimit: 40, next: { day: 5, limit: 80 } },
    });
  });

  it("teto manual do dono abaixo da curva vira o limite (D14)", async () => {
    await setConnection(b.tenantId, {
      firstConnectedAt: new Date(Date.now() - 3 * DAY_MS),
      sentCount: 7,
      countDate: await todayOf(b.tenantId),
      manualLimit: 30,
    });
    const { usage } = (await panel(b, "GET", "/api/whatsapp/usage")).body;
    expect(usage).toMatchObject({ used: 7, limit: 30, manualLimit: 30, warmup: { curveLimit: 40 } });
  });

  it("contador de outro dia vale zero e número maduro tem limite 200 sem próximo degrau", async () => {
    await setConnection(b.tenantId, {
      firstConnectedAt: new Date(Date.now() - 30 * DAY_MS),
      sentCount: 150,
      countDate: "2020-01-01",
    });
    const { usage } = (await panel(b, "GET", "/api/whatsapp/usage")).body;
    expect(usage).toMatchObject({
      configured: true,
      used: 0,
      limit: 200,
      warmup: { day: 31, inWarmup: false, curveLimit: 200, next: null },
    });
  });

  it("ignora parâmetros de consulta, inclusive forjados", async () => {
    const result = await panel(b, "GET", `/api/whatsapp/usage?day=2020-01-01&limit=9999&tenantId=${a.tenantId}`);
    expect(result.status).toBe(200);
    expect(result.body.usage).toMatchObject({ configured: true, limit: 200 });
  });
});

describe("GET /api/whatsapp/blocked", () => {
  let contactB: { id: string; name: string; phone: string };
  let blockedNewer: string;
  let blockedOlder: string;

  beforeAll(async () => {
    contactB = await createContact(b.tenantId, "Cliente B bloqueado");
    blockedOlder = (await createOutbound(b.tenantId, contactB.id, "blocked", {
      blockReason: "no_channel",
      updatedAt: new Date(Date.now() - 60_000),
    })).id;
    blockedNewer = (await createOutbound(b.tenantId, contactB.id, "blocked", { blockReason: "opt_out" })).id;
    // Os outros desfechos não aparecem na lista.
    await createOutbound(b.tenantId, contactB.id, "queued");
    await createOutbound(b.tenantId, contactB.id, "sent");
    await createOutbound(b.tenantId, contactB.id, "expired");
  });

  it("lista só os bloqueados, mais recente primeiro, com motivo e contato", async () => {
    const result = await panel(b, "GET", "/api/whatsapp/blocked");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const { blocked } = result.body;
    expect(blocked).toMatchObject({ page: 1, pageSize: 50, hasMore: false });
    expect(blocked.items.map((item: { id: string }) => item.id)).toEqual([blockedNewer, blockedOlder]);
    expect(blocked.items[0]).toEqual({
      id: blockedNewer,
      messageType: "appointment_confirmation",
      channel: null,
      reason: "opt_out",
      scheduledFor: expect.any(String),
      createdAt: expect.any(String),
      blockedAt: expect.any(String),
      contact: { id: contactB.id, name: contactB.name, phone: contactB.phone },
    });
    expect(blocked.items[1].reason).toBe("no_channel");
    // Nada interno: chave de idempotência, id externo, tenant.
    const text = JSON.stringify(result.body);
    expect(text).not.toContain("idempotency");
    expect(text).not.toContain("externalId");
    expect(text).not.toContain(b.tenantId);
  });

  it("pagina de 50 em 50", async () => {
    const contact = await createContact(b.tenantId, "Cliente B em massa");
    const base = Date.now() - DAY_MS;
    await prisma.outboundMessage.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        tenantId: b.tenantId,
        contactId: contact.id,
        messageType: "appointment_confirmation",
        status: "blocked",
        blockReason: "not_eligible",
        idempotencyKey: `painel-massa-${i}-${randomUUID()}`,
        updatedAt: new Date(base - i * 1000),
      })),
    });
    const first = (await panel(b, "GET", "/api/whatsapp/blocked")).body.blocked;
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const second = (await panel(b, "GET", "/api/whatsapp/blocked?page=2")).body.blocked;
    expect(second).toMatchObject({ page: 2, hasMore: false });
    expect(second.items).toHaveLength(2);
    expect((await panel(b, "GET", "/api/whatsapp/blocked?page=3")).body.blocked.items).toEqual([]);
  });

  it("página inválida: 400 no formato padrão", async () => {
    for (const page of ["0", "-1", "abc", "1.5", "10001"]) {
      const result = await panel(b, "GET", `/api/whatsapp/blocked?page=${page}`);
      expect(result.status, page).toBe(400);
      expect(result.body.error).toEqual({ code: "invalid_input", message: expect.stringContaining("Página") });
    }
  });

  it("tenant sem bloqueios recebe lista vazia", async () => {
    expect((await panel(a, "GET", "/api/whatsapp/blocked")).body.blocked).toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      hasMore: false,
    });
  });
});

describe("templates", () => {
  it("GET lista um template por tipo, na ordem da lista fechada, com variáveis e limites", async () => {
    const result = await panel(a, "GET", "/api/message-templates");
    expect(result.status).toBe(200);
    const { templates } = result.body;
    expect(templates.map((t: { messageType: string }) => t.messageType)).toEqual([...OUTBOUND_MESSAGE_TYPES]);
    for (const template of templates) {
      const type = template.messageType as (typeof OUTBOUND_MESSAGE_TYPES)[number];
      expect(template).toEqual({
        id: expect.any(String),
        messageType: type,
        variations: [...DEFAULT_TEMPLATES[type]],
        active: true,
        variables: [...TEMPLATE_VARIABLES[type]],
        isDefault: true,
        limits: { minVariations: 3, maxVariations: 10, maxLength: 1000 },
        updatedAt: expect.any(String),
      });
    }
    expect(JSON.stringify(result.body)).not.toContain(a.tenantId);
  });

  it("GET lista recria o padrão de tenant sem templates (anterior à Fase 5)", async () => {
    await prisma.messageTemplate.deleteMany({ where: { tenantId: a.tenantId } });
    const { templates } = (await panel(a, "GET", "/api/message-templates")).body;
    expect(templates).toHaveLength(OUTBOUND_MESSAGE_TYPES.length);
    expect(await prisma.messageTemplate.count({ where: { tenantId: a.tenantId } })).toBe(OUTBOUND_MESSAGE_TYPES.length);
  });

  it("GET por ID", async () => {
    const { id } = await templateOf(a.tenantId, "optout_confirmation");
    const result = await panel(a, "GET", `/api/message-templates/${id}`);
    expect(result.status).toBe(200);
    expect(result.body.template).toMatchObject({ id, messageType: "optout_confirmation", isDefault: true });
  });

  it("PATCH troca as variações (sem espaços nas pontas) e o tipo nunca muda", async () => {
    const { id } = await templateOf(a.tenantId, "appointment_confirmation");
    const variations = [
      "  Oi, {{nome}}! {{servico}} confirmado para {{data}} às {{hora}}.  ",
      "{{nome}}, te esperamos em {{data}}, {{hora}}, com {{profissional}}. {{negocio}}",
      "Confirmado, {{ nome }}: {{servico}} em {{data}}.",
      "Tudo certo para {{data}}!",
    ];
    const result = await panel(a, "PATCH", `/api/message-templates/${id}`, {
      body: { variations, messageType: "optout_confirmation", active: false, tenantId: b.tenantId },
    });
    expect(result.status).toBe(200);
    expect(result.body.template).toMatchObject({
      id,
      messageType: "appointment_confirmation",
      variations: variations.map((text) => text.trim()),
      active: true,
      isDefault: false,
    });
    const stored = await templateOf(a.tenantId, "appointment_confirmation");
    expect(stored.variations).toEqual(variations.map((text) => text.trim()));
    expect(stored.active).toBe(true);
    // GET devolve o editado.
    expect((await panel(a, "GET", `/api/message-templates/${id}`)).body.template.variations).toEqual(stored.variations);
  });

  it("PATCH inválido: 400 no formato padrão, com os problemas por posição, e nada muda", async () => {
    const { id } = await templateOf(a.tenantId, "optout_confirmation");
    const ok = ["Saiu, {{nome}}.", "Pronto, {{nome}}, {{negocio}} parou.", "Combinado."];
    const cases: { label: string; body?: unknown; rawBody?: string; code: string; issue?: object }[] = [
      { label: "variável desconhecida", body: { variations: [...ok.slice(0, 2), "Seu {{servico}}."] }, code: "invalid_template", issue: { code: "unknown_variable", index: 2, variable: "servico" } },
      { label: "texto vazio", body: { variations: [...ok, "   "] }, code: "invalid_template", issue: { code: "empty", index: 3 } },
      { label: "poucas variações", body: { variations: ok.slice(0, 2) }, code: "invalid_template", issue: { code: "too_few" } },
      { label: "lista vazia", body: { variations: [] }, code: "invalid_template", issue: { code: "too_few" } },
      { label: "variações demais", body: { variations: Array.from({ length: 11 }, (_, i) => `Texto ${i}`) }, code: "invalid_template", issue: { code: "too_many" } },
      { label: "duplicada", body: { variations: [...ok, ` ${ok[0]} `] }, code: "invalid_template", issue: { code: "duplicate", index: 3 } },
      { label: "variável mal escrita", body: { variations: [...ok, "Oi {{nome"] }, code: "invalid_template", issue: { code: "malformed_variable", index: 3 } },
      { label: "longa demais", body: { variations: [...ok, "x".repeat(1001)] }, code: "invalid_template", issue: { code: "too_long", index: 3 } },
      { label: "sem variations", body: {}, code: "invalid_input" },
      { label: "variations não é lista", body: { variations: "Oi {{nome}}" }, code: "invalid_input" },
      { label: "item não é texto", body: { variations: [...ok, 42] }, code: "invalid_input" },
      { label: "item nulo", body: { variations: [...ok, null] }, code: "invalid_input" },
      { label: "corpo absurdo", body: { variations: Array.from({ length: 51 }, (_, i) => `T${i}`) }, code: "invalid_input" },
      { label: "item absurdo", body: { variations: [...ok, "x".repeat(5001)] }, code: "invalid_input" },
      { label: "JSON quebrado", rawBody: "{variations: [", code: "invalid_input" },
    ];
    const before = await snapshot(a.tenantId);
    for (const { label, body, rawBody, code, issue } of cases) {
      const result = await panel(a, "PATCH", `/api/message-templates/${id}`, rawBody ? { rawBody } : { body });
      expect(result.status, label).toBe(400);
      expect(result.body.error, label).toMatchObject({ code, message: expect.any(String) });
      expect(result.body.error.message.length, label).toBeGreaterThan(0);
      if (issue) {
        expect(result.body.error.issues, label).toContainEqual(expect.objectContaining({ ...issue, message: expect.any(String) }));
        expect(result.body.error.message, label).toBe(result.body.error.issues[0].message);
      } else {
        expect(Object.keys(result.body.error), label).toEqual(["code", "message"]);
      }
    }
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it("a mensagem da variável desconhecida diz qual é e em que posição", async () => {
    const { id } = await templateOf(a.tenantId, "optout_confirmation");
    const result = await panel(a, "PATCH", `/api/message-templates/${id}`, {
      body: { variations: ["Oi {{nome}}.", "Oi {{cupom}}.", "Tchau."] },
    });
    expect(result.body.error.message).toBe("A variação 2 usa a variável {{cupom}}, que não existe para esta mensagem.");
  });

  it("POST restore volta ao texto padrão do tipo", async () => {
    const { id } = await templateOf(a.tenantId, "appointment_confirmation");
    expect((await templateOf(a.tenantId, "appointment_confirmation")).variations).not.toEqual([...DEFAULT_TEMPLATES.appointment_confirmation]);
    const result = await panel(a, "POST", `/api/message-templates/${id}/restore`, { body: { messageType: "optout_confirmation" } });
    expect(result.status).toBe(200);
    expect(result.body.template).toMatchObject({
      id,
      messageType: "appointment_confirmation",
      variations: [...DEFAULT_TEMPLATES.appointment_confirmation],
      isDefault: true,
    });
    expect((await templateOf(a.tenantId, "appointment_confirmation")).variations).toEqual([...DEFAULT_TEMPLATES.appointment_confirmation]);
    // O outro tipo não muda.
    expect((await templateOf(a.tenantId, "optout_confirmation")).variations).toEqual([...DEFAULT_TEMPLATES.optout_confirmation]);
  });

  it("ID inexistente ou malformado: 404 em ler, editar e restaurar", async () => {
    const body = { variations: ["Um {{nome}}.", "Dois.", "Três."] };
    for (const id of [randomUUID(), "nao-e-uuid"]) {
      for (const [method, path] of PANEL_CALLS.filter(([, p]) => p.includes(":id"))) {
        const result = await panel(a, method, path.replace(":id", id), method === "GET" ? {} : { body });
        expect(result, `${method} ${path} ${id}`).toMatchObject({
          status: 404,
          body: { error: { code: "not_found", message: "Template não encontrado." } },
        });
      }
    }
  });

  it("métodos sem rota não existem (sem criar nem apagar template)", () => {
    expect(templatesRoute).not.toHaveProperty("POST");
    expect(templateRoute).not.toHaveProperty("DELETE");
    expect(templateRoute).not.toHaveProperty("PUT");
  });
});

describe("isolamento entre tenants", () => {
  let templatesB: { id: string }[];
  let blockedB: string;

  beforeAll(async () => {
    templatesB = await templatesOf(b.tenantId);
    // Dado distinto no B: template editado e um bloqueio com nome marcador.
    await prisma.messageTemplate.update({
      where: { id: templatesB[0].id },
      data: { variations: ["Texto do B {{nome}}.", "Segundo do B.", "Terceiro do B."] },
    });
    const contact = await createContact(b.tenantId, "Marcador do B");
    blockedB = (await createOutbound(b.tenantId, contact.id, "blocked", { blockReason: "opt_out" })).id;
  });

  it("o tenant A é negado em todas as rotas de ID do B e nada do B muda", async () => {
    const before = await snapshot(b.tenantId);
    for (const { id } of templatesB) {
      for (const [method, path] of PANEL_CALLS.filter(([, p]) => p.includes(":id"))) {
        const result = await panel(a, method, path.replace(":id", id), {
          body: method === "GET" ? undefined : { variations: ["Invadido {{nome}}.", "Invadido 2.", "Invadido 3."] },
        });
        expect(result, `${method} ${path}`).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
        expect(JSON.stringify(result.body)).not.toContain("do B");
      }
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
    // O B continua lendo o próprio template.
    const own = await panel(b, "GET", `/api/message-templates/${templatesB[0].id}`);
    expect(own.body.template.variations[0]).toBe("Texto do B {{nome}}.");
  });

  it("as listas do A não mostram nada do B (uso, bloqueios e templates)", async () => {
    const usageA = (await panel(a, "GET", "/api/whatsapp/usage")).body.usage;
    expect(usageA).toMatchObject({ configured: false, used: 0 });

    const blockedA = (await panel(a, "GET", "/api/whatsapp/blocked")).body.blocked;
    expect(blockedA.items).toEqual([]);
    expect(JSON.stringify(blockedA)).not.toContain(blockedB);

    const templatesA = (await panel(a, "GET", "/api/message-templates")).body.templates;
    const idsA = templatesA.map((t: { id: string }) => t.id);
    for (const { id } of templatesB) expect(idsA).not.toContain(id);
    expect(JSON.stringify(templatesA)).not.toContain("do B");
  });

  it("nenhuma rota aceita tenantId do cliente (cabeçalho, consulta ou corpo)", async () => {
    const before = await snapshot(b.tenantId);
    const forgedHeaders = { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: randomUUID() };
    const forgedBody = { tenantId: b.tenantId, variations: ["Forjado {{nome}}.", "Forjado 2.", "Forjado 3."] };
    for (const [method, path] of PANEL_CALLS) {
      const concrete = `${path.replace(":id", templatesB[0].id)}?tenantId=${b.tenantId}`;
      const result = await panel(a, method, concrete, {
        headers: forgedHeaders,
        body: method === "GET" ? undefined : forgedBody,
      });
      const label = `${method} ${path}`;
      expect(result.reachedHandler, label).toBe(true);
      // O proxy troca o cabeçalho forjado pelo tenant da sessão.
      expect(result.forwardedHeaders?.get(TENANT_ID_HEADER), label).toBe(a.tenantId);
      const text = JSON.stringify(result.body);
      expect(text, label).not.toContain(b.tenantId);
      expect(text, label).not.toContain("do B");
      expect(text, label).not.toContain(blockedB);
      if (path.includes(":id")) expect(result.status, label).toBe(404);
      else expect(result.status, label).toBe(200);
    }
    expect(await snapshot(b.tenantId)).toEqual(before);

    // O template do A editado com tenantId do B no corpo continua sendo do A.
    const { id } = await templateOf(a.tenantId, "optout_confirmation");
    const edited = await panel(a, "PATCH", `/api/message-templates/${id}`, { headers: forgedHeaders, body: forgedBody });
    expect(edited.status).toBe(200);
    expect((await templateOf(a.tenantId, "optout_confirmation")).variations[0]).toBe("Forjado {{nome}}.");
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
});
