import { randomInt, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { proxy } from "@/proxy";
import { SESSION_COOKIE } from "@/server/auth/session";

// Helpers dos testes de auth: dados únicos por teste, requisições e limpeza na branch test.

const BASE_URL = "http://localhost:3000";
const createdEmails = new Set<string>();
const usedIps = new Set<string>();

export function uniqueEmail(label = "dono"): string {
  const email = `${label}-${randomUUID().slice(0, 8)}@teste.slotz.dev`;
  createdEmails.add(email);
  return email;
}

// IP próprio por teste: o limite por IP de um teste não interfere nos outros.
export function uniqueIp(): string {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  usedIps.add(ip);
  return ip;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
}

export function apiRequest(path: string, options: RequestOptions = {}): NextRequest {
  const headers = new Headers(options.headers);
  if (options.cookie !== undefined) headers.set("cookie", `${SESSION_COOKIE}=${options.cookie}`);
  if (options.ip) headers.set("x-forwarded-for", options.ip);
  let body: string | undefined;
  if (options.rawBody !== undefined || options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = options.rawBody ?? JSON.stringify(options.body);
  }
  return new NextRequest(`${BASE_URL}${path}`, { method: options.method ?? "GET", headers, body });
}

export interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
}

export function parseSetCookie(header: string): ParsedCookie {
  const [pair, ...attrs] = header.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const attributes: Record<string, string | true> = {};
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    if (i === -1) attributes[attr.toLowerCase()] = true;
    else attributes[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1);
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes };
}

export function sessionCookieOf(response: Response): ParsedCookie | null {
  const cookie = response.headers
    .getSetCookie()
    .map(parseSetCookie)
    .find((c) => c.name === SESSION_COOKIE);
  return cookie ?? null;
}

// Executa o proxy como o Next faz: se ele deixa passar, monta a requisição que o route handler
// receberia, com os cabeçalhos reescritos (x-middleware-request-*) e o mesmo corpo.
export async function throughProxy(request: NextRequest) {
  const body = request.body ? await request.clone().text() : undefined;
  const proxyResponse = await proxy(request);
  if (proxyResponse.headers.get("x-middleware-next") !== "1") {
    return { proxyResponse, forwarded: null };
  }
  const names = proxyResponse.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  const headers = new Headers();
  for (const name of names) {
    const value = proxyResponse.headers.get(`x-middleware-request-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return { proxyResponse, forwarded: new NextRequest(request.url, { method: request.method, headers, body }) };
}

export async function cleanupAuthData(): Promise<void> {
  const emails = [...createdEmails];
  const ips = [...usedIps];
  if (emails.length > 0) {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { tenantId: true } });
    await prisma.tenant.deleteMany({ where: { id: { in: users.map((u) => u.tenantId) } } });
  }
  await prisma.loginAttempt.deleteMany({ where: { OR: [{ email: { in: emails } }, { ip: { in: ips } }] } });
  createdEmails.clear();
  usedIps.clear();
}
