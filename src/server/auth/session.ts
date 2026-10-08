import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { createAuthRepository, type AuthRepository, type NewSession } from "@/server/repositories/auth-repository";

// Sessão no banco (D1, premissa c): o cookie leva um token aleatório; o banco guarda só o
// SHA-256 dele. Vale 30 dias, com renovação deslizante; logout apaga a linha.

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
// Renova quando falta menos da metade do prazo: no máximo uma escrita a cada ~15 dias.
export const SESSION_RENEW_BELOW_MS = 15 * DAY_MS;

// Prefixo __Host-: o navegador só aceita o cookie com Secure, Path=/ e sem Domain (host-only),
// então ele nunca vaza para outros subdomínios da Algoritmi.
export const SESSION_COOKIE = "__Host-slotz_session";

export interface SessionCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function sessionCookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: maxAgeSeconds };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession extends NewSession {
  token: string;
}

export function issueSession(now: Date = new Date()): IssuedSession {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date, now = new Date()): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

export interface ValidSession {
  tenantId: string;
  userId: string;
  expiresAt: Date;
  renewed: boolean;
}

// Token desconhecido ou vencido = null. Perto do fim, empurra o vencimento (deslizante).
export async function validateSession(
  token: string,
  now: Date = new Date(),
  repo: AuthRepository = createAuthRepository(),
): Promise<ValidSession | null> {
  if (!token) return null;
  const session = await repo.findActiveSession(hashSessionToken(token), now);
  if (!session) return null;

  const { tenantId, userId } = session;
  if (session.expiresAt.getTime() - now.getTime() >= SESSION_RENEW_BELOW_MS) {
    return { tenantId, userId, expiresAt: session.expiresAt, renewed: false };
  }
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await repo.extendSession(session.id, expiresAt);
  return { tenantId, userId, expiresAt, renewed: true };
}

export async function revokeSession(token: string, repo: AuthRepository = createAuthRepository()): Promise<void> {
  if (token) await repo.deleteSession(hashSessionToken(token));
}
