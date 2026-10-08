import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/auth/client-ip";
import { getAuthContext, TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { hashSessionToken, issueSession, SESSION_TTL_MS, sessionCookieOptions } from "@/server/auth/session";
import { nextFreeSlug, slugify, SLUG_MAX_LENGTH } from "@/server/auth/slug";
import { loginSchema, registerSchema } from "@/server/validation/auth";

describe("slug do tenant (D3, premissa b)", () => {
  it("gera do nome: minúsculas, sem acento, hífens", () => {
    expect(slugify("Estúdio da Ána & Cia.")).toBe("estudio-da-ana-cia");
    expect(slugify("  Barbearia   São João  ")).toBe("barbearia-sao-joao");
  });

  it("nome sem letras/dígitos vira 'negocio' e nome longo é cortado sem hífen no fim", () => {
    expect(slugify("✨ !!! ✨")).toBe("negocio");
    const long = slugify(`${"a".repeat(SLUG_MAX_LENGTH - 1)} bbbb`);
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(long.endsWith("-")).toBe(false);
  });

  it("em colisão usa sufixo numérico, o primeiro livre", () => {
    expect(nextFreeSlug("ana", [])).toBe("ana");
    expect(nextFreeSlug("ana", ["ana"])).toBe("ana-2");
    expect(nextFreeSlug("ana", ["ana", "ana-2", "ana-3"])).toBe("ana-4");
    expect(nextFreeSlug("ana", ["ana", "ana-3"])).toBe("ana-2");
  });
});

describe("validação de entrada", () => {
  const valid = { businessName: "Studio Bia", email: "Bia@Exemplo.com", password: "12345678" };

  it("normaliza o e-mail (premissa a)", () => {
    expect(registerSchema.parse({ ...valid, email: "  Bia@Exemplo.COM " }).email).toBe("bia@exemplo.com");
    expect(loginSchema.parse({ email: " BIA@exemplo.com", password: "x" }).email).toBe("bia@exemplo.com");
  });

  it("senha com menos de 8 caracteres é fraca (D1); 8 passa", () => {
    expect(registerSchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: "12345678" }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(false);
  });

  it("recusa e-mail inválido e nome do negócio vazio", () => {
    expect(registerSchema.safeParse({ ...valid, email: "nao-e-email" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, businessName: "   " }).success).toBe(false);
  });
});

describe("sessão e cookie", () => {
  it("cookie host-only, HttpOnly, Secure, SameSite=Lax, Path=/ (D1)", () => {
    expect(sessionCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 });
    expect(sessionCookieOptions(60)).not.toHaveProperty("domain");
  });

  it("token aleatório; o banco guarda só o SHA-256; vale 30 dias", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const a = issueSession(now);
    const b = issueSession(now);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.tokenHash).toBe(hashSessionToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
    expect(a.expiresAt.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });
});

describe("contexto injetado pelo proxy", () => {
  const tenantId = "0199c6f0-0000-7000-8000-000000000001";
  const userId = "0199c6f0-0000-7000-8000-000000000002";

  it("lê tenantId e userId dos cabeçalhos", () => {
    const headers = new Headers({ [TENANT_ID_HEADER]: tenantId, [USER_ID_HEADER]: userId });
    expect(getAuthContext(headers)).toEqual({ tenantId, userId });
  });

  it("sem cabeçalho ou com valor malformado não há contexto", () => {
    expect(getAuthContext(new Headers())).toBeNull();
    expect(getAuthContext(new Headers({ [TENANT_ID_HEADER]: tenantId }))).toBeNull();
    expect(getAuthContext(new Headers({ [TENANT_ID_HEADER]: "x", [USER_ID_HEADER]: userId }))).toBeNull();
  });
});

describe("IP do cliente", () => {
  it("usa o primeiro x-forwarded-for, depois x-real-ip, senão balde comum", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
