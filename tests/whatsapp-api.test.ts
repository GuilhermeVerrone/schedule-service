import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import * as webhookRoute from "@/app/api/webhooks/whatsapp/route";
import * as whatsappRoute from "@/app/api/whatsapp/route";
import * as connectRoute from "@/app/api/whatsapp/connect/route";
import * as reconnectRoute from "@/app/api/whatsapp/reconnect/route";
import * as disconnectRoute from "@/app/api/whatsapp/disconnect/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as conversationMessagesRoute from "@/app/api/conversations/[id]/messages/route";
import { isWebhookApi } from "@/proxy";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { PUBLIC_RATE_LIMITS } from "@/server/http/rate-limit";
import { isValidWebhookSecret, WEBHOOK_SECRET_HEADER } from "@/server/http/webhook-secret";
import { processWhatsAppWebhook } from "@/server/messaging/webhook";
import type { WhatsAppWebhookRepository } from "@/server/repositories/whatsapp-webhook-repository";
import {
  FakeProvider,
  getWhatsAppProvider,
  resetWhatsAppProvider,
  type FakeWebhookPayload,
} from "@/server/whatsapp";
import { apiRequest, cleanupAuthData, sessionCookieOf, uniqueEmail } from "./helpers/auth";
import { createRouteCaller, type CallOptions, type Method, type RouteModule } from "./helpers/api-routes";

// Fase 5 (whatsapp-conexao-mensagens): API do WhatsApp. Webhook público (segredo em tempo
// constante, limite por IP, corpo inválido → 200 vazio, sessão desconhecida e duplicado sem
// efeito) e rotas do painel (conectar por QR, status, reconectar, desconectar, conversas e
// mensagens) com o FakeProvider. Isolamento: o tenant A nunca alcança dados do B, sem sessão nada
// passa e nenhuma rota aceita tenantId do cliente (guia 3, 4, 6, 7, 9; D3, D6, D8). Toda
// requisição passa pelo proxy de verdade antes do handler. Banco: branch test do Neon.

const PASSWORD = "senha-forte-123";
const SECRET = randomBytes(24).toString("base64url");
// Valor marcador da chave do provedor: nenhuma resposta pode contê-lo.
const API_KEY_SENTINEL = `chave-secreta-${randomUUID()}`;

// Tabela de rotas igual às árvores /api/whatsapp, /api/conversations e /api/webhooks.
const ROUTES = {
  "/api/webhooks/whatsapp": webhookRoute,
  "/api/whatsapp": whatsappRoute,
  "/api/whatsapp/connect": connectRoute,
  "/api/whatsapp/reconnect": reconnectRoute,
  "/api/whatsapp/disconnect": disconnectRoute,
  "/api/conversations": conversationsRoute,
  "/api/conversations/[id]/messages": conversationMessagesRoute,
} as unknown as Record<string, RouteModule>;

// Rotas do painel com o método e um caminho concreto (conversa: substituída por um ID real).
const PANEL_CALLS: [Method, string][] = [
  ["GET", "/api/whatsapp"],
  ["POST", "/api/whatsapp/connect"],
  ["POST", "/api/whatsapp/reconnect"],
  ["POST", "/api/whatsapp/disconnect"],
  ["GET", "/api/conversations"],
  ["GET", "/api/conversations/:id/messages"],
];

const { call } = createRouteCaller(ROUTES);

const usedIps = new Set<string>();
function newIp(): string {
  const ip = `192.168.${randomInt(256)}.${randomInt(1, 255)}`;
  usedIps.add(ip);
  return ip;
}
const WEBHOOK_IP = newIp();

interface Account {
  token: string;
  tenantId: string;
}

async function register(businessName: string): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName, email: uniqueEmail("whatsapp"), password: PASSWORD },
    }),
  );
  expect(response.status).toBe(201);
  return { token: sessionCookieOf(response)!.value, tenantId: (await response.json()).tenant.id as string };
}

const fake = (): FakeProvider => getWhatsAppProvider() as FakeProvider;
const phone = () => `+55119${randomInt(10_000_000, 99_999_999)}`;

interface HookOptions {
  secret?: string | null;
  ip?: string;
  rawBody?: string;
  token?: string;
  headers?: Record<string, string>;
}

function hook(body: FakeWebhookPayload | unknown, options: HookOptions = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": options.ip ?? WEBHOOK_IP, ...options.headers };
  const secret = options.secret === undefined ? SECRET : options.secret;
  if (secret !== null) headers[WEBHOOK_SECRET_HEADER] = secret;
  const callOptions: CallOptions = { headers, token: options.token };
  if (options.rawBody !== undefined) callOptions.rawBody = options.rawBody;
  else callOptions.body = body;
  return call("POST", "/api/webhooks/whatsapp", callOptions);
}

function message(sessionId: string, extra: Partial<Extract<FakeWebhookPayload, { type: "message" }>> = {}) {
  return {
    type: "message",
    sessionId,
    messageId: `in_${randomUUID()}`,
    from: phone(),
    profileName: "Cliente Zap",
    text: "Oi, tem horário amanhã?",
    ...extra,
  } satisfies FakeWebhookPayload;
}

const panel = (account: Account, method: Method, path: string, options: CallOptions = {}) =>
  call(method, path, { token: account.token, ...options });

// Foto de tudo o que o WhatsApp grava para um tenant: nada pode mudar nos casos recusados.
async function snapshot(tenantId: string) {
  const [connection, contacts, conversations, messages, events] = await Promise.all([
    prisma.whatsAppConnection.findUnique({
      where: { tenantId },
      select: { status: true, sessionId: true, lastCheckedAt: true },
    }),
    prisma.contact.findMany({ where: { tenantId }, select: { id: true, phone: true, lastInboundAt: true }, orderBy: { id: "asc" } }),
    prisma.conversation.findMany({ where: { tenantId }, select: { id: true, lastMessageAt: true }, orderBy: { id: "asc" } }),
    prisma.message.findMany({ where: { tenantId }, select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.webhookEvent.count({ where: { tenantId } }),
  ]);
  return { connection, contacts, conversations, messages, events };
}

const sessionOf = async (tenantId: string): Promise<string> =>
  (await prisma.whatsAppConnection.findUniqueOrThrow({ where: { tenantId } })).sessionId;

// Conecta um tenant de ponta a ponta pelo painel e pelo QR do Fake.
async function connectAccount(account: Account): Promise<string> {
  const started = await panel(account, "POST", "/api/whatsapp/connect");
  expect(started.body.connection.status).toBe("qr_pending");
  const sessionId = await sessionOf(account.tenantId);
  await fake().simulateQrScan(sessionId);
  expect((await panel(account, "GET", "/api/whatsapp")).body.connection.status).toBe("connected");
  return sessionId;
}

let a: Account;
let b: Account;

beforeAll(async () => {
  vi.stubEnv("WHATSAPP_PROVIDER", "fake");
  vi.stubEnv("WHATSAPP_WEBHOOK_SECRET", SECRET);
  resetWhatsAppProvider();
  [a, b] = await Promise.all([register("Zap A"), register("Zap B")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  resetWhatsAppProvider();
  vi.unstubAllEnvs();
  await prisma.rateLimitHit.deleteMany({ where: { key: { in: [...usedIps] } } });
  await cleanupAuthData();
  await prisma.$disconnect();
});

describe("cobertura e proxy", () => {
  it("ROUTES são exatamente as rotas das árvores do WhatsApp em src/app/api", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[])
      .filter((file) => file.split(sep).at(-1) === "route.ts")
      .map((file) => ["/api", ...file.split(sep).slice(0, -1)].join("/"))
      .filter((route) => ["/api/whatsapp", "/api/conversations", "/api/webhooks"].some((p) => route.startsWith(p)))
      // Uso do dia e bloqueios (fila-envio-limites-elegibilidade) têm a própria tabela em
      // tests/outbound-panel-api.test.ts.
      .filter((route) => !["/api/whatsapp/usage", "/api/whatsapp/blocked"].includes(route))
      .sort();
    expect(routes).toEqual(Object.keys(ROUTES).sort());
  });

  it("só /api/webhooks/whatsapp é público; o resto do WhatsApp exige sessão", () => {
    expect(isWebhookApi("/api/webhooks/whatsapp")).toBe(true);
    expect(isWebhookApi("/api/webhooks/whatsapp/")).toBe(true);
    expect(isWebhookApi("/api/webhooks/whatsappx")).toBe(false);
    expect(isWebhookApi("/api/webhooks")).toBe(false);
    expect(isWebhookApi("/api/whatsapp")).toBe(false);
  });

  it("webhook chega ao handler sem sessão e sem tenantId, mesmo com cookie do dono e cabeçalhos forjados", async () => {
    const result = await hook(
      {},
      { token: a.token, headers: { [TENANT_ID_HEADER]: a.tenantId, [USER_ID_HEADER]: randomUUID() } },
    );
    expect(result.reachedHandler).toBe(true);
    expect(result.forwardedHeaders?.get(TENANT_ID_HEADER)).toBeNull();
    expect(result.forwardedHeaders?.get(USER_ID_HEADER)).toBeNull();
    expect(result.status).toBe(200);
  });

  it("sem sessão, todas as rotas do painel dão 401 sem chegar ao handler", async () => {
    for (const [method, path] of PANEL_CALLS) {
      const result = await call(method, path.replace(":id", randomUUID()));
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body.error.code).toBe("unauthorized");
      expect(result.reachedHandler).toBe(false);
    }
    // Sessão inventada também não passa.
    const forged = await call("GET", "/api/whatsapp", { token: randomBytes(32).toString("base64url") });
    expect(forged.status).toBe(401);
  });
});

describe("webhook: segredo (D8)", () => {
  let sessionId: string;
  beforeAll(async () => {
    sessionId = await connectAccount(a);
  });

  it("sem segredo, com segredo errado ou do mesmo tamanho: 401 e nada muda", async () => {
    const before = await snapshot(a.tenantId);
    const wrongSameLength = SECRET.slice(0, -1) + (SECRET.endsWith("x") ? "y" : "x");
    for (const secret of [null, "", "errado", wrongSameLength, `${SECRET}x`, SECRET.toUpperCase()]) {
      const result = await hook(message(sessionId), { secret });
      expect(result.status, String(secret)).toBe(401);
      expect(result.body.error.code).toBe("unauthorized");
    }
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it("Bearer com o segredo também vale; Bearer errado não", async () => {
    const ok = await hook(message(sessionId), { secret: null, headers: { authorization: `Bearer ${SECRET}` } });
    expect(ok.status).toBe(200);
    const bad = await hook(message(sessionId), { secret: null, headers: { authorization: "Bearer outro-segredo-qualquer" } });
    expect(bad.status).toBe(401);
  });

  it("segredo não configurado ou curto demais recusa tudo (falha fechada)", () => {
    const headers = (value: string) => new Headers({ [WEBHOOK_SECRET_HEADER]: value });
    expect(isValidWebhookSecret(headers(""), { WHATSAPP_WEBHOOK_SECRET: "" })).toBe(false);
    expect(isValidWebhookSecret(headers("x"), {})).toBe(false);
    expect(isValidWebhookSecret(headers("curto"), { WHATSAPP_WEBHOOK_SECRET: "curto" })).toBe(false);
    expect(isValidWebhookSecret(headers(SECRET), { WHATSAPP_WEBHOOK_SECRET: SECRET })).toBe(true);
  });

  it("comparação em tempo constante: tamanhos diferentes não lançam (os dois lados viram hash)", () => {
    const env = { WHATSAPP_WEBHOOK_SECRET: SECRET };
    for (const value of ["a", "a".repeat(1000), "ç".repeat(40)]) {
      expect(() => isValidWebhookSecret(new Headers({ [WEBHOOK_SECRET_HEADER]: value }), env)).not.toThrow();
      expect(isValidWebhookSecret(new Headers({ [WEBHOOK_SECRET_HEADER]: value }), env)).toBe(false);
    }
  });

  it("sem segredo no ambiente, nem o segredo antigo entra", async () => {
    vi.stubEnv("WHATSAPP_WEBHOOK_SECRET", "");
    try {
      expect((await hook(message(sessionId))).status).toBe(401);
      expect((await hook(message(sessionId), { secret: "" })).status).toBe(401);
    } finally {
      vi.stubEnv("WHATSAPP_WEBHOOK_SECRET", SECRET);
    }
  });
});

describe("webhook: corpo, sessão e idempotência (D3, D8)", () => {
  let sessionId: string;
  beforeAll(async () => {
    sessionId = await sessionOf(a.tenantId);
    expect((await prisma.whatsAppConnection.findUnique({ where: { tenantId: a.tenantId } }))?.status).toBe("connected");
  });

  it("corpo inválido responde 200 vazio e não grava nada", async () => {
    const before = [await snapshot(a.tenantId), await snapshot(b.tenantId)];
    const cases: HookOptions[] = [
      { rawBody: "" },
      { rawBody: "{quebrado" },
      { rawBody: "null" },
      { rawBody: "[]" },
      { rawBody: JSON.stringify({ type: "message", sessionId }) },
      { rawBody: JSON.stringify({ type: "desconhecido", sessionId }) },
      { rawBody: JSON.stringify(message(sessionId, { from: "abc" })) },
      { rawBody: JSON.stringify(message(sessionId, { text: null, mediaType: null })) },
      { rawBody: JSON.stringify(message(sessionId, { text: "x".repeat(300 * 1024) })) },
    ];
    for (const options of cases) {
      const result = await hook(undefined, options);
      expect(result.status, options.rawBody?.slice(0, 40)).toBe(200);
      expect(result.body).toBeNull();
      expect(result.reachedHandler).toBe(true);
    }
    expect([await snapshot(a.tenantId), await snapshot(b.tenantId)]).toEqual(before);
  });

  it("o log do corpo inválido não leva o conteúdo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await hook(undefined, { rawBody: JSON.stringify(message(sessionId, { from: "abc", text: "conteúdo-sigiloso" })) });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("invalid_body");
    expect(logged).not.toContain("conteúdo-sigiloso");
    expect(logged).not.toContain(sessionId);
  });

  it("sessão desconhecida: 200 vazio e nenhum tenant muda", async () => {
    const before = [await snapshot(a.tenantId), await snapshot(b.tenantId)];
    const unknown = `fake_${randomUUID()}`;
    for (const body of [
      message(unknown),
      { type: "connection", sessionId: unknown, state: "disconnected" },
      { type: "delivery", sessionId: unknown, messageId: "x", state: "read" },
    ]) {
      const result = await hook(body);
      expect(result.status).toBe(200);
      expect(result.body).toBeNull();
    }
    expect([await snapshot(a.tenantId), await snapshot(b.tenantId)]).toEqual(before);
  });

  it("mensagem recebida grava contato, conversa e mensagem uma única vez, mesmo reenviada", async () => {
    const body = message(sessionId, { profileName: "Maria Zap" });
    const before = await snapshot(a.tenantId);
    for (let i = 0; i < 3; i += 1) {
      const result = await hook(body);
      expect(result.status).toBe(200);
      expect(result.body).toBeNull();
    }
    const after = await snapshot(a.tenantId);
    expect(after.messages.length).toBe(before.messages.length + 1);
    expect(after.events).toBe(before.events + 1);
    expect(after.contacts.length).toBe(before.contacts.length + 1);
    const contact = await prisma.contact.findFirstOrThrow({ where: { tenantId: a.tenantId, phone: body.from } });
    expect(contact).toMatchObject({ name: "Maria Zap", consentSource: "whatsapp_inbound", consentAt: null });
    expect(contact.lastInboundAt).toBeInstanceOf(Date);

    // Reenvios simultâneos também gravam uma vez só.
    const parallel = message(sessionId);
    const results = await Promise.all([1, 2, 3, 4].map(() => hook(parallel)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await prisma.message.count({ where: { tenantId: a.tenantId, externalId: parallel.messageId } })).toBe(1);
  });

  it("evento de conexão pelo webhook atualiza só a conexão daquela sessão", async () => {
    await connectAccount(b);
    const beforeB = await snapshot(b.tenantId);
    const result = await hook({
      type: "connection",
      sessionId,
      state: "disconnected",
      reason: "connection_lost",
      timestamp: new Date(Date.now() + 5).toISOString(),
    });
    expect(result.status).toBe(200);
    expect((await panel(a, "GET", "/api/whatsapp")).body.connection.status).toBe("disconnected");
    expect(await snapshot(b.tenantId)).toEqual(beforeB);
    // Volta a conectar para os próximos testes.
    await panel(a, "POST", "/api/whatsapp/reconnect");
    await fake().simulateQrScan(sessionId);
    expect((await panel(a, "GET", "/api/whatsapp")).body.connection.status).toBe("connected");
  });

  it("falha ao gravar sobe (a rota responde 500 e o provedor reenvia); corpo inválido não", async () => {
    const provider = new FakeProvider();
    const failing = { recordEvent: () => Promise.reject(new Error("banco fora")) } as unknown as WhatsAppWebhookRepository;
    await expect(processWhatsAppWebhook(provider, message("s"), failing)).rejects.toThrow("banco fora");
    expect(await processWhatsAppWebhook(provider, { type: "x" }, failing)).toMatchObject({ status: "invalid" });
  });
});

describe("webhook: limite por IP (D8)", () => {
  it("passado o teto da janela, 429 com Retry-After, mesmo com o segredo certo; outro IP segue", async () => {
    const ip = newIp();
    const { bucket, max } = PUBLIC_RATE_LIMITS.whatsappWebhook;
    await prisma.rateLimitHit.createMany({ data: Array.from({ length: max }, () => ({ bucket, key: ip })) });
    const sessionId = await sessionOf(a.tenantId);
    const before = await snapshot(a.tenantId);
    const blocked = await hook(message(sessionId), { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(await snapshot(a.tenantId)).toEqual(before);
    // Tentativas com segredo errado também contam (o limite vem antes do segredo).
    expect((await hook(message(sessionId), { ip, secret: "errado" })).status).toBe(429);
    expect((await hook(message(sessionId), { ip: newIp() })).status).toBe(200);
  });

  it("segredo errado repetido esgota o balde do IP", async () => {
    const ip = newIp();
    const { bucket, max } = PUBLIC_RATE_LIMITS.whatsappWebhook;
    await prisma.rateLimitHit.createMany({ data: Array.from({ length: max - 2 }, () => ({ bucket, key: ip })) });
    expect((await hook({}, { ip, secret: "chute-1" })).status).toBe(401);
    expect((await hook({}, { ip, secret: "chute-2" })).status).toBe(401);
    expect((await hook({}, { ip, secret: "chute-3" })).status).toBe(429);
  });
});

describe("conexão pelo painel com o FakeProvider (jornadas 7a, 7b, 7e)", () => {
  let c: Account;
  beforeAll(async () => {
    c = await register("Zap C");
  });

  it("fluxo completo: QR, conectado, queda, reconectar e desconectar", async () => {
    // Antes de conectar.
    const initial = await panel(c, "GET", "/api/whatsapp");
    expect(initial).toMatchObject({ status: 200, body: { connection: { status: "not_configured", qr: null } } });
    expect((await panel(c, "POST", "/api/whatsapp/reconnect")).status).toBe(404);
    expect((await panel(c, "POST", "/api/whatsapp/disconnect")).status).toBe(404);

    // QR.
    const started = await panel(c, "POST", "/api/whatsapp/connect");
    expect(started.status).toBe(200);
    expect(started.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(started.body.connection).toMatchObject({ status: "qr_pending", live: true });
    expect(started.body.connection.qr).toMatchObject({ format: "text", value: expect.any(String) });
    expect(new Date(started.body.connection.qr.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const sessionId = await sessionOf(c.tenantId);
    // O id da sessão (chave do webhook) não vai para o navegador como campo. (O conteúdo do QR é
    // do provedor: o do Fake carrega o id, o de um provedor real é o código de pareamento.)
    const { qr, ...withoutQr } = started.body.connection;
    expect(JSON.stringify({ ...withoutQr, qr: { ...qr, value: null } })).not.toContain(sessionId);
    expect((await snapshot(c.tenantId)).connection?.status).toBe("qr_pending");

    // Pedir de novo enquanto espera a leitura mantém a mesma sessão.
    const again = await panel(c, "POST", "/api/whatsapp/connect");
    expect(again.body.connection.status).toBe("qr_pending");
    expect(await sessionOf(c.tenantId)).toBe(sessionId);

    // Conectado.
    await fake().simulateQrScan(sessionId);
    const connected = await panel(c, "GET", "/api/whatsapp");
    expect(connected.body.connection).toMatchObject({ status: "connected", qr: null, live: true });
    expect(connected.body.connection.lastCheckedAt).not.toBeNull();
    expect((await snapshot(c.tenantId)).connection?.status).toBe("connected");
    expect(await panel(c, "POST", "/api/whatsapp/connect")).toMatchObject({
      status: 409,
      body: { error: { code: "already_connected" } },
    });
    expect((await panel(c, "POST", "/api/whatsapp/reconnect")).status).toBe(409);

    // Queda.
    await fake().simulateDisconnect(sessionId);
    const dropped = await panel(c, "GET", "/api/whatsapp");
    expect(dropped.body.connection).toMatchObject({ status: "disconnected", qr: null });
    expect((await snapshot(c.tenantId)).connection?.status).toBe("disconnected");

    // Reconectar: mesma sessão, QR novo.
    const reconnect = await panel(c, "POST", "/api/whatsapp/reconnect");
    expect(reconnect.body.connection.status).toBe("qr_pending");
    expect(reconnect.body.connection.qr.value).not.toBe(started.body.connection.qr.value);
    expect(await sessionOf(c.tenantId)).toBe(sessionId);
    await fake().simulateQrScan(sessionId);
    expect((await panel(c, "GET", "/api/whatsapp")).body.connection.status).toBe("connected");

    // Desconectar (repetir não é erro).
    const off = await panel(c, "POST", "/api/whatsapp/disconnect");
    expect(off).toMatchObject({ status: 200, body: { connection: { status: "disconnected", qr: null } } });
    expect((await panel(c, "GET", "/api/whatsapp")).body.connection.status).toBe("disconnected");
    expect((await panel(c, "POST", "/api/whatsapp/disconnect")).body.connection.status).toBe("disconnected");

    // Conectar de novo depois de desconectar: QR novo.
    const fresh = await panel(c, "POST", "/api/whatsapp/connect");
    expect(fresh.body.connection.status).toBe("qr_pending");
  });

  it("suspeita de banimento aparece no status e permite reconectar", async () => {
    const sessionId = await sessionOf(c.tenantId);
    await fake().simulateQrScan(sessionId);
    await fake().simulateBan(sessionId);
    expect((await panel(c, "GET", "/api/whatsapp")).body.connection.status).toBe("banned_suspected");
    expect((await panel(c, "POST", "/api/whatsapp/reconnect")).body.connection.status).toBe("qr_pending");
  });

  it("sessão perdida no provedor: o status vira desconectado e conectar gera QR de novo", async () => {
    const otherSessions = await Promise.all([a, b].map((account) => sessionOf(account.tenantId)));
    fake().reset();
    try {
      expect((await panel(c, "GET", "/api/whatsapp")).body.connection.status).toBe("disconnected");
      const reconnect = await panel(c, "POST", "/api/whatsapp/connect");
      expect(reconnect.body.connection.status).toBe("qr_pending");
      await fake().simulateQrScan(await sessionOf(c.tenantId));
      expect((await panel(c, "GET", "/api/whatsapp")).body.connection.status).toBe("connected");
    } finally {
      // Recria as sessões de A e B no Fake (o reset apagou a memória dele).
      for (const sessionId of otherSessions) {
        await fake().connect({ sessionId });
        await fake().simulateQrScan(sessionId);
      }
    }
  });
});

describe("conversas e mensagens (jornada 7d; D6, D7)", () => {
  it("lista e lê a conversa do próprio tenant, 50 por página, mídia só como tipo", async () => {
    const sessionId = await sessionOf(a.tenantId);
    const from = phone();
    await hook(message(sessionId, { from, text: "primeira" }));
    await hook(message(sessionId, { from, text: null, mediaType: "image" }));

    const list = await panel(a, "GET", "/api/conversations");
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(list.body.conversations).toMatchObject({ page: 1, pageSize: 50, hasMore: false });
    const conversation = list.body.conversations.items.find((item: { contact: { phone: string } }) => item.contact.phone === from);
    expect(conversation.lastMessage).toMatchObject({ direction: "inbound", body: null, mediaType: "image" });
    expect(conversation).not.toHaveProperty("tenantId");

    const read = await panel(a, "GET", `/api/conversations/${conversation.id}/messages`);
    expect(read.status).toBe(200);
    expect(read.body.conversation).toMatchObject({ id: conversation.id, contact: { phone: from } });
    expect(read.body.messages).toMatchObject({ page: 1, pageSize: 50, hasMore: false });
    expect(read.body.messages.items.map((m: { body: string | null; mediaType: string | null }) => m.body ?? `[${m.mediaType}]`)).toEqual([
      "[image]",
      "primeira",
    ]);
    for (const item of read.body.messages.items) {
      expect(Object.keys(item).sort()).toEqual(["body", "direction", "id", "mediaType", "sentAt", "status"]);
    }
    expect((await panel(a, "GET", `/api/conversations/${conversation.id}/messages?page=2`)).body.messages.items).toEqual([]);
  });

  it("página inválida: 400 no formato padrão", async () => {
    for (const page of ["0", "-1", "abc", "1.5"]) {
      const list = await panel(a, "GET", `/api/conversations?page=${page}`);
      expect(list.status, page).toBe(400);
      expect(list.body.error).toMatchObject({ code: "invalid_input", message: expect.stringContaining("Página") });
    }
  });

  it("ID inexistente ou malformado: 404", async () => {
    for (const id of [randomUUID(), "nao-e-uuid"]) {
      expect(await panel(a, "GET", `/api/conversations/${id}/messages`)).toMatchObject({
        status: 404,
        body: { error: { code: "not_found" } },
      });
    }
  });
});

describe("isolamento entre tenants", () => {
  let conversationOfB: string;
  let conversationOfA: string;

  beforeAll(async () => {
    const [sessionA, sessionB] = await Promise.all([sessionOf(a.tenantId), sessionOf(b.tenantId)]);
    const fromB = phone();
    await hook(message(sessionB, { from: fromB, text: "mensagem do B" }));
    conversationOfB = (await prisma.conversation.findFirstOrThrow({
      where: { tenantId: b.tenantId, contact: { phone: fromB } },
    })).id;
    const fromA = phone();
    await hook(message(sessionA, { from: fromA, text: "mensagem do A" }));
    conversationOfA = (await prisma.conversation.findFirstOrThrow({
      where: { tenantId: a.tenantId, contact: { phone: fromA } },
    })).id;
  });

  it("o tenant A é negado em todas as rotas do B e nada do B muda", async () => {
    // Deixa o A desconectado e o B conectado, para os estados serem distintos.
    await panel(a, "POST", "/api/whatsapp/disconnect");
    const beforeB = await snapshot(b.tenantId);

    const status = await panel(a, "GET", "/api/whatsapp");
    expect(status.body.connection.status).toBe("disconnected");

    // Conectar e reconectar do A mexem só na conexão do A.
    expect((await panel(a, "POST", "/api/whatsapp/connect")).body.connection.status).toBe("qr_pending");
    expect((await panel(a, "POST", "/api/whatsapp/reconnect")).body.connection.status).toBe("qr_pending");
    expect((await panel(a, "POST", "/api/whatsapp/disconnect")).body.connection.status).toBe("disconnected");

    const list = await panel(a, "GET", "/api/conversations");
    const ids = list.body.conversations.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(conversationOfA);
    expect(ids).not.toContain(conversationOfB);
    expect(JSON.stringify(list.body)).not.toContain("mensagem do B");

    const other = await panel(a, "GET", `/api/conversations/${conversationOfB}/messages`);
    expect(other).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    expect(JSON.stringify(other.body)).not.toContain("mensagem do B");

    expect(await snapshot(b.tenantId)).toEqual(beforeB);
    expect((await panel(b, "GET", "/api/whatsapp")).body.connection.status).toBe("connected");
    // O B continua lendo a própria conversa.
    expect((await panel(b, "GET", `/api/conversations/${conversationOfB}/messages`)).status).toBe(200);
  });

  it("nenhuma rota aceita tenantId do cliente (cabeçalho, consulta ou corpo)", async () => {
    const beforeB = await snapshot(b.tenantId);
    const forged = {
      headers: { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: randomUUID() },
      body: { tenantId: b.tenantId, sessionId: beforeB.connection?.sessionId },
    };
    for (const [method, path] of PANEL_CALLS) {
      const concrete = `${path.replace(":id", conversationOfB)}?tenantId=${b.tenantId}`;
      const result = await panel(a, method, concrete, method === "GET" ? { headers: forged.headers } : forged);
      expect(result.forwardedHeaders?.get(TENANT_ID_HEADER), `${method} ${path}`).toBe(a.tenantId);
      expect(JSON.stringify(result.body)).not.toContain("mensagem do B");
      expect(JSON.stringify(result.body)).not.toContain(b.tenantId);
    }
    // A conversa do B pedida com o tenantId do B forjado continua 404 para o A.
    const read = await panel(a, "GET", `/api/conversations/${conversationOfB}/messages?tenantId=${b.tenantId}`, {
      headers: forged.headers,
    });
    expect(read.status).toBe(404);
    expect(await snapshot(b.tenantId)).toEqual(beforeB);
    // O webhook também ignora tenantId no corpo: o tenant vem da sessão.
    const sessionA = await sessionOf(a.tenantId);
    await fake().connect({ sessionId: sessionA });
    await fake().simulateQrScan(sessionA);
    await panel(a, "GET", "/api/whatsapp");
    const from = phone();
    expect((await hook({ ...message(sessionA, { from }), tenantId: b.tenantId })).status).toBe(200);
    expect(await prisma.contact.count({ where: { tenantId: a.tenantId, phone: from } })).toBe(1);
    expect(await prisma.contact.count({ where: { tenantId: b.tenantId, phone: from } })).toBe(0);
  });
});

describe("segredos nunca saem nas respostas", () => {
  it("com o provedor real configurado, nenhuma resposta (corpo ou cabeçalho) contém a chave da API", async () => {
    // Desconectado antes da troca: conectar vai até o provedor (e não para no 409).
    await panel(a, "POST", "/api/whatsapp/disconnect");
    vi.stubEnv("WHATSAPP_PROVIDER", "akg");
    vi.stubEnv("AKG_API_KEY", API_KEY_SENTINEL);
    vi.stubEnv("AKG_BASE_URL", "https://provedor.invalid");
    resetWhatsAppProvider();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const responses = [];
      for (const [method, path] of PANEL_CALLS) {
        responses.push(await panel(a, method, path.replace(":id", randomUUID())));
      }
      responses.push(await hook(message("qualquer")));
      responses.push(await hook({}, { secret: "errado" }));

      for (const response of responses) {
        const text = JSON.stringify(response.body) + JSON.stringify([...response.headers.entries()]);
        expect(text).not.toContain(API_KEY_SENTINEL);
        expect(text).not.toContain(SECRET);
      }
      // Provedor sem os endpoints confirmados: estado gravado (live = false) e 503 padrão nas ações.
      const [status, connect] = responses;
      expect(status.body.connection).toMatchObject({ live: false });
      expect(connect).toMatchObject({ status: 503, body: { error: { code: "whatsapp_unavailable" } } });
      // O log de falha do webhook também não leva a chave.
      expect(errorLog.mock.calls.flat().join(" ")).not.toContain(API_KEY_SENTINEL);
    } finally {
      vi.stubEnv("WHATSAPP_PROVIDER", "fake");
      resetWhatsAppProvider();
    }
  });
});
