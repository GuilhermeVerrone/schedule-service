import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { LOGIN_WINDOW_MS, MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP } from "@/server/auth/rate-limit";
import { hashSessionToken, SESSION_COOKIE, SESSION_RENEW_BELOW_MS, SESSION_TTL_MS } from "@/server/auth/session";
import { createAuthRepository, UniqueViolationError } from "@/server/repositories/auth-repository";
import {
  apiRequest,
  cleanupAuthData,
  sessionCookieOf,
  throughProxy,
  uniqueEmail,
  uniqueIp,
  type ParsedCookie,
} from "./helpers/auth";

const PASSWORD = "senha-forte-123";
const THIRTY_DAYS_S = SESSION_TTL_MS / 1000;

afterAll(async () => {
  await cleanupAuthData();
  await prisma.$disconnect();
});

interface Account {
  email: string;
  token: string;
  tenantId: string;
  userId: string;
  slug: string;
}

async function registerAccount(businessName = "Studio Teste", email = uniqueEmail()): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", { method: "POST", body: { businessName, email, password: PASSWORD } }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  return {
    email: body.user.email,
    token: sessionCookieOf(response)!.value,
    tenantId: body.tenant.id,
    userId: body.user.id,
    slug: body.tenant.slug,
  };
}

function loginRequest(email: string, password: string, ip: string) {
  return loginRoute(apiRequest("/api/auth/login", { method: "POST", body: { email, password }, ip }));
}

async function callSessionRoute(token: string | undefined) {
  const { proxyResponse, forwarded } = await throughProxy(
    apiRequest("/api/auth/session", token === undefined ? {} : { cookie: token }),
  );
  return { proxyResponse, response: forwarded ? await sessionRoute(forwarded) : proxyResponse };
}

// Flags exigidas pelo D1 / Contexto Mestre: host-only (sem Domain), HttpOnly, Secure, SameSite=Lax.
function expectSecureSessionCookie(cookie: ParsedCookie | null, maxAge: number): void {
  expect(cookie).not.toBeNull();
  expect(cookie!.name).toBe(SESSION_COOKIE);
  expect(cookie!.attributes.httponly).toBe(true);
  expect(cookie!.attributes.secure).toBe(true);
  expect(String(cookie!.attributes.samesite).toLowerCase()).toBe("lax");
  expect(cookie!.attributes.path).toBe("/");
  expect(cookie!.attributes).not.toHaveProperty("domain");
  expect(Number(cookie!.attributes["max-age"])).toBeGreaterThanOrEqual(maxAge - 5);
  expect(Number(cookie!.attributes["max-age"])).toBeLessThanOrEqual(maxAge);
}

describe("cadastro (guia 7a, D3, premissa b)", () => {
  it("cria tenant e dono, abre a sessão e devolve o cookie (token fora do corpo)", async () => {
    const email = uniqueEmail();
    const response = await registerRoute(
      apiRequest("/api/auth/register", {
        method: "POST",
        body: { businessName: "  Estúdio Ána Beleza ", email: `  ${email.toUpperCase()} `, password: PASSWORD },
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.user).toEqual({ id: expect.any(String), email, role: "owner" });
    expect(body.tenant).toMatchObject({ name: "Estúdio Ána Beleza", timezone: "America/Sao_Paulo" });
    expect(body.tenant.slug).toMatch(/^estudio-ana-beleza(-\d+)?$/);

    const cookie = sessionCookieOf(response);
    expectSecureSessionCookie(cookie, THIRTY_DAYS_S);
    expect(JSON.stringify(body)).not.toContain(cookie!.value);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.tenantId).toBe(body.tenant.id);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);

    // O banco guarda só o hash do token.
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashSessionToken(cookie!.value));
    expect(sessions[0].tenantId).toBe(body.tenant.id);
  });

  it("entra logado: o cookie do cadastro já abre /api/auth/session", async () => {
    const account = await registerAccount("Barbearia do Zé");
    const { response } = await callSessionRoute(account.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: account.userId, email: account.email, role: "owner" },
      tenant: { id: account.tenantId, slug: account.slug },
    });
  });

  it("nome repetido ganha sufixo numérico no slug, inclusive em cadastros simultâneos", async () => {
    const name = `Clinica Colisao ${Date.now()}`;
    const first = await registerAccount(name);
    const [second, third] = await Promise.all([registerAccount(name), registerAccount(name)]);
    const slugs = [first.slug, second.slug, third.slug];
    expect(first.slug).toBe(`clinica-colisao-${name.split(" ").pop()}`);
    expect(new Set(slugs).size).toBe(3);
    expect(slugs.sort()).toEqual([first.slug, `${first.slug}-2`, `${first.slug}-3`].sort());
  });

  it("senha fraca: 400 weak_password e nada é criado", async () => {
    const email = uniqueEmail();
    const response = await registerRoute(
      apiRequest("/api/auth/register", {
        method: "POST",
        body: { businessName: "Fraca", email, password: "1234567" },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "weak_password", message: "A senha precisa ter pelo menos 8 caracteres." },
    });
    expect(sessionCookieOf(response)).toBeNull();
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("e-mail duplicado (mesmo com outra caixa): 409 email_in_use, sem segundo tenant", async () => {
    const account = await registerAccount("Original");
    const copyName = `Copia ${Date.now()}`;
    const response = await registerRoute(
      apiRequest("/api/auth/register", {
        method: "POST",
        body: { businessName: copyName, email: account.email.toUpperCase(), password: PASSWORD },
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("email_in_use");
    expect(sessionCookieOf(response)).toBeNull();
    expect(await prisma.user.count({ where: { email: account.email } })).toBe(1);
    expect(await prisma.tenant.count({ where: { name: copyName } })).toBe(0);
  });

  it("transação: se o dono não pode ser criado, o tenant também não fica", async () => {
    const account = await registerAccount("Transacao");
    const slug = `orfao-${Date.now()}`;
    await expect(
      createAuthRepository().createOwnerAccount({
        tenantName: "Órfão",
        slug,
        email: account.email,
        passwordHash: "x",
        session: { tokenHash: `orfao-${Date.now()}`, expiresAt: new Date(Date.now() + 1000) },
      }),
    ).rejects.toEqual(new UniqueViolationError("email"));
    expect(await prisma.tenant.count({ where: { slug } })).toBe(0);
  });

  it("entrada inválida ou JSON quebrado: 400 invalid_input no formato padrão", async () => {
    const bad = [
      { body: { businessName: "X Y", email: "nao-e-email", password: PASSWORD } },
      { body: { email: uniqueEmail(), password: PASSWORD } },
      { rawBody: "{quebrado" },
    ];
    for (const options of bad) {
      const response = await registerRoute(apiRequest("/api/auth/register", { method: "POST", ...options }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("invalid_input");
      expect(typeof body.error.message).toBe("string");
    }
  });
});

describe("login (guia 7b, D1, premissas d-e)", () => {
  it("credenciais certas: 200, nova sessão e cookie seguro; e-mail sem diferenciar caixa", async () => {
    const account = await registerAccount("Login OK");
    const response = await loginRequest(`  ${account.email.toUpperCase()}`, PASSWORD, uniqueIp());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: account.userId, role: "owner" },
      tenant: { id: account.tenantId },
    });
    const cookie = sessionCookieOf(response);
    expectSecureSessionCookie(cookie, THIRTY_DAYS_S);
    expect(cookie!.value).not.toBe(account.token);
    expect(await prisma.session.count({ where: { userId: account.userId } })).toBe(2);
  });

  it("erro genérico: senha errada e e-mail inexistente dão a mesma resposta", async () => {
    const account = await registerAccount("Generico");
    const wrongPassword = await loginRequest(account.email, "senha-errada-1", uniqueIp());
    const unknownEmail = await loginRequest(uniqueEmail("ninguem"), "senha-errada-1", uniqueIp());

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const [a, b] = [await wrongPassword.json(), await unknownEmail.json()];
    expect(a).toEqual({ error: { code: "invalid_credentials", message: "E-mail ou senha incorretos." } });
    expect(b).toEqual(a);
    expect(sessionCookieOf(wrongPassword)).toBeNull();
    expect(sessionCookieOf(unknownEmail)).toBeNull();
  });

  it(`bloqueia o e-mail após ${MAX_FAILURES_PER_EMAIL} falhas, até com a senha certa, e libera depois da janela`, async () => {
    const account = await registerAccount("Bloqueio Email");
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      // IP diferente a cada tentativa: o bloqueio aqui é pelo e-mail.
      expect((await loginRequest(account.email, `errada-${i}-xx`, uniqueIp())).status).toBe(401);
    }

    const blocked = await loginRequest(account.email, PASSWORD, uniqueIp());
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: { code: "too_many_attempts", message: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
    });
    expect(sessionCookieOf(blocked)).toBeNull();
    // Tentativa bloqueada não é registrada (não estende o bloqueio).
    expect(await prisma.loginAttempt.count({ where: { email: account.email } })).toBe(MAX_FAILURES_PER_EMAIL);

    // Janela vencida: as falhas saem da conta.
    await prisma.loginAttempt.updateMany({
      where: { email: account.email },
      data: { createdAt: new Date(Date.now() - LOGIN_WINDOW_MS - 60_000) },
    });
    expect((await loginRequest(account.email, PASSWORD, uniqueIp())).status).toBe(200);
  });

  it("e-mail inexistente também é bloqueado (não revela se a conta existe)", async () => {
    const email = uniqueEmail("fantasma");
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      expect((await loginRequest(email, "qualquer-senha", uniqueIp())).status).toBe(401);
    }
    expect((await loginRequest(email, "qualquer-senha", uniqueIp())).status).toBe(429);
  });

  it("login bem-sucedido zera a contagem do e-mail", async () => {
    const account = await registerAccount("Zera Contagem");
    const ip = uniqueIp();
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL - 1; i++) {
      expect((await loginRequest(account.email, "errada-xxxx", ip)).status).toBe(401);
    }
    expect((await loginRequest(account.email, PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL - 1; i++) {
      expect((await loginRequest(account.email, "errada-xxxx", ip)).status).toBe(401);
    }
    expect((await loginRequest(account.email, PASSWORD, ip)).status).toBe(200);
  });

  it(`bloqueia o IP após ${MAX_FAILURES_PER_IP} falhas em e-mails variados; outro IP segue livre`, async () => {
    const account = await registerAccount("Bloqueio IP");
    const ip = uniqueIp();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      expect((await loginRequest(uniqueEmail(`varre${i}`), "qualquer-senha", ip)).status).toBe(401);
    }
    expect((await loginRequest(account.email, PASSWORD, ip)).status).toBe(429);
    expect((await loginRequest(account.email, PASSWORD, uniqueIp())).status).toBe(200);
  });

  it("corpo inválido: 400 invalid_input, sem registrar tentativa", async () => {
    const ip = uniqueIp();
    const response = await loginRoute(
      apiRequest("/api/auth/login", { method: "POST", body: { email: "x" }, ip }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_input");
    expect(await prisma.loginAttempt.count({ where: { ip } })).toBe(0);
  });
});

describe("logout (guia 7b, premissa c)", () => {
  it("apaga a sessão no banco, expira o cookie e o token antigo deixa de valer", async () => {
    const account = await registerAccount("Logout");
    expect((await callSessionRoute(account.token)).response.status).toBe(200);

    const { proxyResponse, forwarded } = await throughProxy(
      apiRequest("/api/auth/logout", { method: "POST", cookie: account.token }),
    );
    expect(forwarded).not.toBeNull();
    expect(proxyResponse.status).toBe(200);
    const response = await logoutRoute(apiRequest("/api/auth/logout", { method: "POST", cookie: account.token }));
    expect(response.status).toBe(204);

    const cleared = sessionCookieOf(response);
    expect(cleared!.value).toBe("");
    expect(cleared!.attributes["max-age"]).toBe("0");
    expect(cleared!.attributes.httponly).toBe(true);
    expect(cleared!.attributes.secure).toBe(true);
    expect(cleared!.attributes).not.toHaveProperty("domain");

    expect(await prisma.session.count({ where: { tokenHash: hashSessionToken(account.token) } })).toBe(0);
    expect((await callSessionRoute(account.token)).response.status).toBe(401);
  });

  it("só apaga a sessão usada: outra sessão do mesmo dono continua valendo", async () => {
    const account = await registerAccount("Logout Parcial");
    const other = sessionCookieOf(await loginRequest(account.email, PASSWORD, uniqueIp()))!.value;
    await logoutRoute(apiRequest("/api/auth/logout", { method: "POST", cookie: account.token }));
    expect((await callSessionRoute(other)).response.status).toBe(200);
  });

  it("sem cookie ou com token desconhecido: 204 (idempotente)", async () => {
    expect((await logoutRoute(apiRequest("/api/auth/logout", { method: "POST" }))).status).toBe(204);
    const response = await logoutRoute(apiRequest("/api/auth/logout", { method: "POST", cookie: "nao-existe" }));
    expect(response.status).toBe(204);
  });
});

describe("proxy: sessão e tenantId injetado (guia 6)", () => {
  it("sessão válida injeta tenantId e userId da sessão", async () => {
    const account = await registerAccount("Proxy");
    const { forwarded } = await throughProxy(apiRequest("/api/qualquer", { cookie: account.token }));
    expect(forwarded!.headers.get(TENANT_ID_HEADER)).toBe(account.tenantId);
    expect(forwarded!.headers.get(USER_ID_HEADER)).toBe(account.userId);
  });

  it("cabeçalho forjado pelo cliente é descartado, com ou sem sessão", async () => {
    const a = await registerAccount("Forja A");
    const b = await registerAccount("Forja B");
    const spoof = { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: b.userId };

    const withSession = await throughProxy(apiRequest("/api/qualquer", { cookie: a.token, headers: spoof }));
    expect(withSession.forwarded!.headers.get(TENANT_ID_HEADER)).toBe(a.tenantId);
    expect(withSession.forwarded!.headers.get(USER_ID_HEADER)).toBe(a.userId);

    // Página pública: passa, mas sem os cabeçalhos forjados. /painel sem sessão vai para o
    // login (Fase 5), mesmo com o cabeçalho forjado.
    const page = await throughProxy(apiRequest("/login", { headers: spoof }));
    expect(page.forwarded!.headers.get(TENANT_ID_HEADER)).toBeNull();
    expect(page.forwarded!.headers.get(USER_ID_HEADER)).toBeNull();
    const panel = await throughProxy(apiRequest("/painel", { headers: spoof }));
    expect(panel.forwarded).toBeNull();
    expect(panel.proxyResponse.status).toBe(307);

    const api = await throughProxy(apiRequest("/api/qualquer", { headers: spoof }));
    expect(api.forwarded).toBeNull();
    expect(api.proxyResponse.status).toBe(401);
  });

  it("rota /api protegida sem sessão: 401 no formato padrão; rotas públicas passam", async () => {
    for (const path of ["/api/auth/session", "/api/professionals", "/api/auth/session/"]) {
      const { proxyResponse, forwarded } = await throughProxy(apiRequest(path));
      expect(forwarded).toBeNull();
      expect(proxyResponse.status).toBe(401);
      expect((await proxyResponse.json()).error.code).toBe("unauthorized");
    }
    for (const path of ["/api/auth/register", "/api/auth/login", "/api/auth/logout"]) {
      expect((await throughProxy(apiRequest(path, { method: "POST" }))).forwarded).not.toBeNull();
    }
  });

  it("token inválido: 401 e o cookie é apagado", async () => {
    const { proxyResponse } = await throughProxy(apiRequest("/api/auth/session", { cookie: "token-falso" }));
    expect(proxyResponse.status).toBe(401);
    const cookie = sessionCookieOf(proxyResponse);
    expect(cookie!.value).toBe("");
    expect(cookie!.attributes["max-age"]).toBe("0");
  });

  it("sessão vencida não vale", async () => {
    const account = await registerAccount("Vencida");
    await prisma.session.update({
      where: { tokenHash: hashSessionToken(account.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await callSessionRoute(account.token)).response.status).toBe(401);
  });

  it("renovação deslizante: perto do fim volta a valer 30 dias e o cookie é reenviado", async () => {
    const account = await registerAccount("Deslizante");
    const tokenHash = hashSessionToken(account.token);

    // Sessão nova: sem escrita nem novo cookie.
    const fresh = await callSessionRoute(account.token);
    expect(fresh.response.status).toBe(200);
    expect(sessionCookieOf(fresh.proxyResponse)).toBeNull();

    await prisma.session.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() + SESSION_RENEW_BELOW_MS - 60_000) },
    });
    const renewed = await callSessionRoute(account.token);
    expect(renewed.response.status).toBe(200);
    expectSecureSessionCookie(sessionCookieOf(renewed.proxyResponse), THIRTY_DAYS_S);
    expect(sessionCookieOf(renewed.proxyResponse)!.value).toBe(account.token);

    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000);
  });

  it("/api/auth/session chamado sem passar pelo proxy (sem contexto) responde 401", async () => {
    const response = await sessionRoute(apiRequest("/api/auth/session", { headers: {} }));
    expect(response.status).toBe(401);
  });
});
