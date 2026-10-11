import { createHash, randomBytes, randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import nextConfig from "../next.config";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import * as professionalsRoute from "@/app/api/professionals/route";
import * as professionalArchiveRoute from "@/app/api/professionals/[id]/archive/route";
import * as professionalServicesRoute from "@/app/api/professionals/[id]/services/route";
import * as professionalWorkingHoursRoute from "@/app/api/professionals/[id]/working-hours/route";
import * as servicesRoute from "@/app/api/services/route";
import * as serviceArchiveRoute from "@/app/api/services/[id]/archive/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as publicSiteRoute from "@/app/api/public/[slug]/route";
import * as publicAvailabilityRoute from "@/app/api/public/[slug]/availability/route";
import * as publicAppointmentsRoute from "@/app/api/public/[slug]/appointments/route";
import * as publicAppointmentRoute from "@/app/api/public/[slug]/appointments/[token]/route";
import * as publicCancelRoute from "@/app/api/public/[slug]/appointments/[token]/cancel/route";
import * as publicRescheduleRoute from "@/app/api/public/[slug]/appointments/[token]/reschedule/route";
import { isPublicSiteApi } from "@/proxy";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { PUBLIC_RATE_LIMITS } from "@/server/http/rate-limit";
import { createRateLimitRepository } from "@/server/repositories/rate-limit-repository";
import { apiRequest, cleanupAuthData, sessionCookieOf, uniqueEmail } from "./helpers/auth";
import { createRouteCaller, type Method, type RouteModule } from "./helpers/api-routes";

// Fase 5 (agenda-link-publico): API pública do site por slug. Dados do site, horários do dia,
// agendar (cliente por telefone, consentimento, token devolvido uma vez), ver, cancelar e remarcar
// pelo token dentro do prazo, limite por IP e cabeçalhos contra vazamento do token
// (guia 6, 7a, 7b, 7c, 7f, 9; D1, D5, D6, D7, D8, D10). Toda requisição passa pelo proxy de
// verdade antes do handler. Banco: branch test do Neon.

const PASSWORD = "senha-forte-123";
const TZ = "America/Sao_Paulo";

// Tabela de rotas igual à árvore src/app/api/public (o teste de cobertura confere).
const PUBLIC_ROUTES = {
  "/api/public/[slug]": publicSiteRoute,
  "/api/public/[slug]/availability": publicAvailabilityRoute,
  "/api/public/[slug]/appointments": publicAppointmentsRoute,
  "/api/public/[slug]/appointments/[token]": publicAppointmentRoute,
  "/api/public/[slug]/appointments/[token]/cancel": publicCancelRoute,
  "/api/public/[slug]/appointments/[token]/reschedule": publicRescheduleRoute,
} as unknown as Record<string, RouteModule>;

const SETUP_ROUTES = {
  "/api/professionals": professionalsRoute,
  "/api/professionals/[id]/archive": professionalArchiveRoute,
  "/api/professionals/[id]/services": professionalServicesRoute,
  "/api/professionals/[id]/working-hours": professionalWorkingHoursRoute,
  "/api/services": servicesRoute,
  "/api/services/[id]/archive": serviceArchiveRoute,
  "/api/settings": settingsRoute,
} as unknown as Record<string, RouteModule>;

const { call, matchRoute } = createRouteCaller({ ...PUBLIC_ROUTES, ...SETUP_ROUTES });

// IP próprio por chamada ou grupo: o limite por IP de um teste não interfere nos outros.
const usedIps = new Set<string>();
function newIp(): string {
  const ip = `172.${randomInt(16, 32)}.${randomInt(256)}.${randomInt(1, 255)}`;
  usedIps.add(ip);
  return ip;
}

interface PublicCall {
  ip?: string;
  body?: unknown;
  rawBody?: string;
  token?: string;
  headers?: Record<string, string>;
}

// Sem sessão por padrão. `token` é o cookie de sessão de um dono (para provar que é ignorado).
function pub(method: Method, path: string, options: PublicCall = {}) {
  return call(method, path, {
    token: options.token,
    body: options.body,
    rawBody: options.rawBody,
    headers: { "x-forwarded-for": options.ip ?? newIp(), ...options.headers },
  });
}

async function expectError(promise: ReturnType<typeof call>, status: number, code: string) {
  const result = await promise;
  expect({ status: result.status, code: result.body?.error?.code }).toEqual({ status, code });
  expect(result.body.error.message.length).toBeGreaterThan(0);
  return result;
}

const dayPlus = (days: number): string => DateTime.now().setZone(TZ).startOf("day").plus({ days }).toISODate()!;
const at = (date: string, time: string): string => DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toUTC().toISO()!;
const localTime = (iso: string): string => DateTime.fromISO(iso, { zone: TZ }).toFormat("HH:mm");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const fakeToken = () => randomBytes(32).toString("base64url");

const DAY = dayPlus(7);

let phoneSeq = 0;
const nextPhone = () => `(21) 9${String(20_000_000 + ++phoneSeq + randomInt(1_000_000) * 10).slice(-8)}`;

interface Account {
  token: string;
  tenantId: string;
  slug: string;
  professionalId: string;
  otherProfessionalId: string;
  serviceId: string;
  archivedServiceId: string;
  archivedProfessionalId: string;
}

// Dois profissionais ativos (08:00-18:00 todos os dias) que atendem um serviço de 60 min, mais um
// serviço arquivado e um profissional arquivado, que não podem aparecer nem ser agendados.
async function setupAccount(businessName: string): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName, email: uniqueEmail("publico"), password: PASSWORD },
    }),
  );
  expect(response.status).toBe(201);
  const token = sessionCookieOf(response)!.value;
  const { tenant } = await response.json();
  const owner = (method: Method, path: string, body?: unknown) => call(method, path, { token, body });

  const service = (await owner("POST", "/api/services", { name: `Corte ${businessName}`, durationMinutes: 60, priceCents: 5000 })).body.service.id as string;
  const archivedService = (await owner("POST", "/api/services", { name: `Antigo ${businessName}`, durationMinutes: 30, priceCents: 1000 })).body.service.id as string;
  const ids: string[] = [];
  for (const name of [`Ana ${businessName}`, `Bia ${businessName}`, `Caio ${businessName}`]) {
    const id = (await owner("POST", "/api/professionals", { name })).body.professional.id as string;
    await owner("PUT", `/api/professionals/${id}/services`, { serviceIds: [service, archivedService] });
    const intervals = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "08:00", end: "18:00" }));
    expect((await owner("PUT", `/api/professionals/${id}/working-hours`, { intervals })).status).toBe(200);
    ids.push(id);
  }
  expect((await owner("POST", `/api/services/${archivedService}/archive`)).status).toBe(200);
  expect((await owner("POST", `/api/professionals/${ids[2]}/archive`)).status).toBe(200);
  return {
    token,
    tenantId: tenant.id,
    slug: tenant.slug,
    professionalId: ids[0],
    otherProfessionalId: ids[1],
    archivedProfessionalId: ids[2],
    serviceId: service,
    archivedServiceId: archivedService,
  };
}

function bookingBody(account: Account, startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    serviceId: account.serviceId,
    professionalId: account.professionalId,
    startsAt,
    customer: { name: "Cliente Público", phone: nextPhone() },
    consent: true,
    ...extra,
  };
}

const book = (account: Account, startsAt: string, extra: Record<string, unknown> = {}, ip?: string) =>
  pub("POST", `/api/public/${account.slug}/appointments`, { ip, body: bookingBody(account, startsAt, extra) });

async function slotTimes(account: Account, date = DAY, professionalId: string | null = account.professionalId) {
  const query = new URLSearchParams({ serviceId: account.serviceId, date });
  if (professionalId) query.set("professionalId", professionalId);
  const result = await pub("GET", `/api/public/${account.slug}/availability?${query}`);
  expect(result.status).toBe(200);
  return (result.body.slots as { startsAt: string }[]).map((slot) => localTime(slot.startsAt));
}

const confirmedAt = (account: Account, startsAt: string) =>
  prisma.appointment.count({ where: { tenantId: account.tenantId, status: "confirmed", startsAt: new Date(startsAt) } });

async function snapshot(account: Account) {
  const [tenant, appointments, customers] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: account.tenantId } }),
    prisma.appointment.findMany({ where: { tenantId: account.tenantId }, orderBy: { id: "asc" } }),
    prisma.customer.findMany({ where: { tenantId: account.tenantId }, orderBy: { id: "asc" } }),
  ]);
  return { tenant, appointments, customers };
}

async function setSettings(account: Account, body: Record<string, unknown>) {
  expect((await call("PATCH", "/api/settings", { token: account.token, body })).status).toBe(200);
}

let a: Account;
let b: Account;

beforeAll(async () => {
  // Em sequência: menos conexões abertas ao mesmo tempo no Neon durante a montagem.
  a = await setupAccount("Site Público A");
  b = await setupAccount("Site Público B");
}, 120_000);

afterAll(async () => {
  await prisma.rateLimitHit.deleteMany({ where: { key: { in: [...usedIps] } } });
  await cleanupAuthData();
  await prisma.$disconnect();
});

describe("cobertura e proxy", () => {
  it("PUBLIC_ROUTES são exatamente as rotas da árvore src/app/api/public", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[])
      .filter((file) => file.split(sep).at(-1) === "route.ts")
      .map((file) => ["/api", ...file.split(sep).slice(0, -1)].join("/"))
      .filter((route) => route.startsWith("/api/public/"))
      .sort();
    expect(routes).toEqual(Object.keys(PUBLIC_ROUTES).sort());
  });

  it("o prefixo público é só /api/public/: o resto da API continua exigindo sessão", async () => {
    expect(isPublicSiteApi("/api/public/x")).toBe(true);
    expect(isPublicSiteApi("/api/public/x/appointments/y/cancel")).toBe(true);
    expect(isPublicSiteApi("/api/public")).toBe(false);
    expect(isPublicSiteApi("/api/publicx/y")).toBe(false);
    expect(isPublicSiteApi("/api/settings")).toBe(false);
    const protectedCall = await call("GET", "/api/settings");
    expect(protectedCall.status).toBe(401);
    expect(protectedCall.reachedHandler).toBe(false);
  });

  it("rota pública chega ao handler sem sessão e sem tenantId injetado, mesmo com sessão de dono e cabeçalho forjado", async () => {
    const result = await pub("GET", `/api/public/${a.slug}`, {
      token: b.token,
      headers: { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: b.tenantId },
    });
    expect(result.status).toBe(200);
    expect(result.reachedHandler).toBe(true);
    expect(result.forwardedHeaders!.get(TENANT_ID_HEADER)).toBeNull();
    expect(result.forwardedHeaders!.get(USER_ID_HEADER)).toBeNull();
    expect(result.body.business.slug).toBe(a.slug);
    // O cookie inválido também não é apagado: o proxy nem olha a sessão no prefixo público.
    expect(result.headers.getSetCookie()).toEqual([]);
  });
});

describe("dados do site", () => {
  it("devolve o negócio, serviços e profissionais ativos e vinculados, sem tenantId nem arquivados", async () => {
    await setSettings(a, { description: "Cortes e barba", address: "Rua A, 10", phone: "(11) 3333-4444" });
    const { status, body } = await pub("GET", `/api/public/${a.slug}`);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["business", "professionals", "services"]);
    expect(body.business).toEqual({
      slug: a.slug,
      name: "Site Público A",
      description: "Cortes e barba",
      address: "Rua A, 10",
      phone: "(11) 3333-4444",
      timezone: TZ,
      booking: { minAdvanceMinutes: 120, maxWindowDays: 60, cancelDeadlineMinutes: 120 },
    });
    expect(body.services.map((s: { id: string }) => s.id)).toEqual([a.serviceId]);
    expect(body.services[0]).toEqual({
      id: a.serviceId,
      name: "Corte Site Público A",
      durationMinutes: 60,
      priceCents: 5000,
      professionalIds: [a.professionalId, a.otherProfessionalId].sort(),
    });
    expect(body.professionals.map((p: { id: string }) => p.id).sort()).toEqual([a.professionalId, a.otherProfessionalId].sort());
    const text = JSON.stringify(body);
    for (const hidden of [a.tenantId, a.archivedServiceId, a.archivedProfessionalId, b.tenantId, b.slug, "tenantId", "archivedAt"]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("slug inexistente (404)", () => {
  const routesFor = (slug: string): [Method, string, unknown?][] => [
    ["GET", `/api/public/${slug}`],
    ["GET", `/api/public/${slug}/availability?serviceId=${a.serviceId}&date=${DAY}`],
    ["POST", `/api/public/${slug}/appointments`, bookingBody(a, at(DAY, "09:00"))],
    ["GET", `/api/public/${slug}/appointments/${fakeToken()}`],
    ["POST", `/api/public/${slug}/appointments/${fakeToken()}/cancel`],
    ["POST", `/api/public/${slug}/appointments/${fakeToken()}/reschedule`, { startsAt: at(DAY, "09:00") }],
  ];

  it("a matriz cobre toda rota pública", () => {
    const covered = new Set(routesFor("x").map(([method, path]) => `${method} ${matchRoute(new URL(path, "http://x").pathname).pattern}`));
    const all = Object.entries(PUBLIC_ROUTES).flatMap(([pattern, mod]) =>
      Object.keys(mod).filter((key) => /^[A-Z]+$/.test(key)).map((method) => `${method} ${pattern}`),
    );
    expect([...covered].sort()).toEqual(all.sort());
  });

  it.each(["nao-existe-xyz", "painel", "login", "api", "Maiusculo", "com--duplo", "a".repeat(80)])(
    "slug %s dá 404 not_found em todas as rotas e nada é gravado",
    async (slug) => {
      const before = await prisma.appointment.count({ where: { tenantId: a.tenantId } });
      for (const [method, path, body] of routesFor(slug)) {
        const result = await expectError(pub(method, path, { body }), 404, "not_found");
        expect(result.body.error.message).toBe("Negócio não encontrado.");
        expect(JSON.stringify(result.body)).not.toContain(a.tenantId);
      }
      expect(await prisma.appointment.count({ where: { tenantId: a.tenantId } })).toBe(before);
    },
  );
});

describe("disponibilidade por dia", () => {
  it("lista horários do dia e não expõe dados de clientes nem de agendamentos", async () => {
    const before = await slotTimes(a);
    expect(before).toContain("09:00");
    expect(before.length).toBe(37);
    const name = "Fulana Segredo da Silva";
    const phone = "(21) 99876-5432";
    const created = await book(a, at(DAY, "09:00"), { customer: { name, phone, email: "fulana@segredo.dev" } });
    expect(created.status).toBe(201);

    const query = new URLSearchParams({ serviceId: a.serviceId, date: DAY });
    for (const path of [`/api/public/${a.slug}/availability?${query}`, `/api/public/${a.slug}/availability?${query}&professionalId=${a.professionalId}`]) {
      const { status, body } = await pub("GET", path);
      expect(status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["date", "slots"]);
      for (const slot of body.slots) expect(Object.keys(slot).sort()).toEqual(["professionalIds", "startsAt"]);
      const text = JSON.stringify(body);
      for (const secret of [name, "Fulana", "5521998765432", "99876", "fulana@segredo.dev", created.body.manageToken, a.tenantId, "customer", "appointment"]) {
        expect(text).not.toContain(secret);
      }
    }
    const after = await slotTimes(a);
    expect(after).not.toContain("09:00");
    expect(after).not.toContain("08:30");
    // "qualquer profissional": às 09:00 só a Bia está livre.
    const any = await pub("GET", `/api/public/${a.slug}/availability?${query}`);
    const nine = any.body.slots.find((slot: { startsAt: string }) => localTime(slot.startsAt) === "09:00");
    expect(nine.professionalIds).toEqual([a.otherProfessionalId]);
  });

  it("aplica antecedência mínima e janela máxima do negócio", async () => {
    expect(await slotTimes(a, dayPlus(60))).toEqual([]);
    expect((await slotTimes(a, dayPlus(59))).length).toBeGreaterThan(0);
    expect(await slotTimes(a, dayPlus(-1))).toEqual([]);
  });

  it("consulta inválida dá 400; serviço ou profissional de outro negócio, arquivado ou inexistente dá 404", async () => {
    for (const query of ["", `serviceId=${a.serviceId}`, `date=${DAY}`, `serviceId=${a.serviceId}&date=amanha`, `serviceId=${a.serviceId}&date=2026-02-30`]) {
      await expectError(pub("GET", `/api/public/${a.slug}/availability?${query}`), 400, "invalid_input");
    }
    for (const query of [
      `serviceId=${b.serviceId}&date=${DAY}`,
      `serviceId=${a.serviceId}&date=${DAY}&professionalId=${b.professionalId}`,
      `serviceId=${a.archivedServiceId}&date=${DAY}`,
      `serviceId=${a.serviceId}&date=${DAY}&professionalId=${a.archivedProfessionalId}`,
      `serviceId=nao-e-uuid&date=${DAY}`,
    ]) {
      const result = await expectError(pub("GET", `/api/public/${a.slug}/availability?${query}`), 404, "not_found");
      expect(JSON.stringify(result.body)).not.toContain(b.tenantId);
    }
  });
});

describe("fluxo completo: agendar, ver, remarcar e cancelar pelo token", () => {
  it("cria com token devolvido uma vez (só o hash no banco), consentimento e cliente por telefone normalizado", async () => {
    const startsAt = at(DAY, "14:00");
    const created = await book(a, startsAt, {
      customer: { name: "  Maria Cliente  ", phone: "+55 (21) 97777-1234", email: "maria@cliente.dev" },
    });
    expect(created.status).toBe(201);
    const { appointment, manageToken, managePath } = created.body;
    expect(manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(managePath).toBe(`/${a.slug}/agendamento/${manageToken}`);
    expect(appointment).toMatchObject({
      status: "confirmed",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      service: { id: a.serviceId, durationMinutes: 60 },
      professional: { id: a.professionalId },
      customer: { name: "Maria Cliente" },
      canManage: true,
    });
    expect(Object.keys(appointment.customer)).toEqual(["name"]);
    for (const hidden of ["id", "tenantId", "manageTokenHash", "customerId"]) expect(appointment).not.toHaveProperty(hidden);

    const row = await prisma.appointment.findFirstOrThrow({ where: { tenantId: a.tenantId, startsAt: new Date(startsAt) }, include: { customer: true } });
    expect(row.manageTokenHash).toBe(sha256(manageToken));
    expect(JSON.stringify(row)).not.toContain(manageToken);
    expect(row.customer).toMatchObject({ name: "Maria Cliente", phone: "5521977771234", email: "maria@cliente.dev", consentSource: "public_booking" });
    expect(row.customer.consentAt).toBeInstanceOf(Date);

    // Mesmo telefone com outra máscara: o mesmo cliente, sem sobrescrever nome; outro token.
    const again = await book(a, at(DAY, "16:00"), { customer: { name: "Outro Nome", phone: "21 97777-1234" } });
    expect(again.status).toBe(201);
    expect(again.body.manageToken).not.toBe(manageToken);
    const second = await prisma.appointment.findFirstOrThrow({ where: { tenantId: a.tenantId, startsAt: new Date(at(DAY, "16:00")) }, include: { customer: true } });
    expect(second.customerId).toBe(row.customerId);
    expect(second.customer.name).toBe("Maria Cliente");

    // O token não volta em nenhuma leitura posterior.
    const view = await pub("GET", `/api/public/${a.slug}/appointments/${manageToken}`);
    expect(JSON.stringify(view.body)).not.toContain(manageToken);
  });

  it("vê, remarca (mesmo link) e cancela; os horários são liberados e ocupados", async () => {
    const created = await book(a, at(DAY, "11:00"), { professionalId: a.otherProfessionalId });
    expect(created.status).toBe(201);
    const token = created.body.manageToken as string;
    const base = `/api/public/${a.slug}/appointments/${token}`;

    const view = await pub("GET", base);
    expect(view.status).toBe(200);
    expect(view.body.appointment).toMatchObject({ status: "confirmed", canManage: true, professional: { id: a.otherProfessionalId } });
    expect(new Date(view.body.appointment.manageableUntil).getTime()).toBe(new Date(at(DAY, "11:00")).getTime() - 2 * 3_600_000);
    expect(Object.keys(view.body.appointment.customer)).toEqual(["name"]);
    expect(await slotTimes(a, DAY, a.otherProfessionalId)).not.toContain("11:00");

    const moved = await pub("POST", `${base}/reschedule`, { body: { startsAt: at(DAY, "15:00") } });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment).toMatchObject({ status: "confirmed", startsAt: new Date(at(DAY, "15:00")).toISOString() });
    const slots = await slotTimes(a, DAY, a.otherProfessionalId);
    expect(slots).toContain("11:00");
    expect(slots).not.toContain("15:00");
    expect((await pub("GET", base)).body.appointment.startsAt).toBe(new Date(at(DAY, "15:00")).toISOString());

    // Remarcar para horário ocupado, fora da agenda ou fora das regras do cliente: 409 e nada muda.
    const occupied = await book(a, at(DAY, "17:00"), { professionalId: a.otherProfessionalId });
    expect(occupied.status).toBe(201);
    for (const startsAt of [at(DAY, "17:00"), at(DAY, "16:30"), at(DAY, "07:00"), at(DAY, "15:10"), at(dayPlus(61), "10:00"), at(dayPlus(-1), "10:00")]) {
      await expectError(pub("POST", `${base}/reschedule`, { body: { startsAt } }), 409, "slot_unavailable");
    }
    for (const body of [{}, { startsAt: "amanha" }, { startsAt: at(DAY, "13:00"), tenantId: b.tenantId }]) {
      await expectError(pub("POST", `${base}/reschedule`, { body }), 400, "invalid_input");
    }
    expect((await pub("GET", base)).body.appointment.startsAt).toBe(new Date(at(DAY, "15:00")).toISOString());

    const canceled = await pub("POST", `${base}/cancel`);
    expect(canceled.status).toBe(200);
    expect(canceled.body.appointment).toMatchObject({ status: "canceled", canManage: false });
    expect(canceled.body.appointment.canceledAt).toBeTruthy();
    expect(await slotTimes(a, DAY, a.otherProfessionalId)).toContain("15:00");

    const again = await pub("POST", `${base}/cancel`);
    expect(again.status).toBe(200);
    expect(again.body.appointment.canceledAt).toBe(canceled.body.appointment.canceledAt);
    await expectError(pub("POST", `${base}/reschedule`, { body: { startsAt: at(DAY, "13:00") } }), 409, "invalid_status");
  });

  it("\"qualquer profissional\" escolhe um livre", async () => {
    const created = await book(a, at(DAY, "12:00"), { professionalId: null });
    expect(created.status).toBe(201);
    expect([a.professionalId, a.otherProfessionalId]).toContain(created.body.appointment.professional.id);
    const omitted = await pub("POST", `/api/public/${a.slug}/appointments`, {
      body: { serviceId: a.serviceId, startsAt: at(DAY, "12:00"), customer: { name: "Sem Prof", phone: nextPhone() }, consent: true },
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.appointment.professional.id).not.toBe(created.body.appointment.professional.id);
    await expectError(book(a, at(DAY, "12:00"), { professionalId: null }), 409, "slot_unavailable");
  });

  it("agendamento concluído pelo dono não é cancelado pelo link", async () => {
    const created = await book(a, at(dayPlus(8), "10:00"));
    expect(created.status).toBe(201);
    await prisma.appointment.updateMany({ where: { manageTokenHash: sha256(created.body.manageToken) }, data: { status: "completed" } });
    await expectError(pub("POST", `/api/public/${a.slug}/appointments/${created.body.manageToken}/cancel`), 409, "invalid_status");
  });
});

describe("agendar: entradas inválidas e regras do cliente", () => {
  it("sem consentimento, com campos a mais ou dados inválidos dá 400 e nada é gravado", async () => {
    const before = await snapshot(a);
    const startsAt = at(DAY, "13:00");
    const valid = bookingBody(a, startsAt);
    const bodies: unknown[] = [
      {},
      { ...valid, consent: undefined },
      { ...valid, consent: false },
      { ...valid, consent: "true" },
      { ...valid, tenantId: b.tenantId },
      { ...valid, endsAt: at(DAY, "18:00") },
      { ...valid, manageTokenHash: sha256("x") },
      { ...valid, customer: undefined },
      { ...valid, customer: { name: "A", phone: nextPhone() } },
      { ...valid, customer: { name: "Nome Ok", phone: "123" } },
      { ...valid, customer: { name: "Nome Ok", phone: nextPhone(), email: "nao-email" } },
      { ...valid, customer: { name: "Nome Ok", phone: nextPhone(), tenantId: b.tenantId } },
      { ...valid, startsAt: "2026-10-20T13:00:00" },
      { ...valid, serviceId: undefined },
    ];
    for (const body of bodies) await expectError(pub("POST", `/api/public/${a.slug}/appointments`, { body }), 400, "invalid_input");
    await expectError(pub("POST", `/api/public/${a.slug}/appointments`, { rawBody: "{quebrado" }), 400, "invalid_input");
    expect(await snapshot(a)).toEqual(before);
  });

  it("serviço ou profissional de outro negócio, arquivado ou sem vínculo dá 404; fora das regras dá 409; nada é gravado", async () => {
    const before = await snapshot(a);
    const startsAt = at(DAY, "13:00");
    for (const extra of [
      { serviceId: b.serviceId },
      { professionalId: b.professionalId },
      { serviceId: b.serviceId, professionalId: null },
      { serviceId: a.archivedServiceId },
      { serviceId: a.archivedServiceId, professionalId: null },
      { professionalId: a.archivedProfessionalId },
      { serviceId: "nao-e-uuid" },
    ]) {
      const result = await expectError(book(a, startsAt, extra), 404, "not_found");
      expect(JSON.stringify(result.body)).not.toContain(b.tenantId);
    }
    for (const time of [at(DAY, "07:00"), at(DAY, "17:30"), at(DAY, "13:10"), at(dayPlus(60), "10:00"), at(dayPlus(-1), "10:00")]) {
      await expectError(book(a, time), 409, "slot_unavailable");
    }
    // Antecedência mínima: daqui a 1 hora não pode (padrão 2 h), mesmo dentro do expediente.
    const soon = DateTime.now().setZone(TZ).plus({ hours: 1 }).startOf("hour");
    await expectError(book(a, soon.toUTC().toISO()!), 409, "slot_unavailable");
    expect(await snapshot(a)).toEqual(before);
  });
});

describe("token inválido", () => {
  it("token inexistente, malformado ou de outro negócio dá 404 em ver, cancelar e remarcar, sem mudar nada", async () => {
    const created = await book(b, at(DAY, "10:00"));
    expect(created.status).toBe(201);
    const bToken = created.body.manageToken as string;
    const beforeA = await snapshot(a);
    const beforeB = await snapshot(b);

    const tokens = [fakeToken(), "curto", "x".repeat(43) + "!", bToken.slice(0, 42), `${bToken}a`, sha256(bToken), bToken.toUpperCase()];
    for (const [slug, token] of [...tokens.map((t) => [a.slug, t]), ...tokens.slice(0, 3).map((t) => [b.slug, t]), [a.slug, bToken]]) {
      const base = `/api/public/${slug}/appointments/${encodeURIComponent(token)}`;
      for (const [method, path, body] of [
        ["GET", base],
        ["POST", `${base}/cancel`],
        ["POST", `${base}/reschedule`, { startsAt: at(DAY, "13:00") }],
      ] as [Method, string, unknown?][]) {
        const result = await expectError(pub(method, path, { body }), 404, "not_found");
        expect(result.body.error.message).toBe("Agendamento não encontrado.");
        expect(JSON.stringify(result.body)).not.toContain("Cliente Público");
      }
    }
    expect(await snapshot(a)).toEqual(beforeA);
    expect(await snapshot(b)).toEqual(beforeB);
    // O token certo, no slug certo, continua funcionando.
    expect((await pub("GET", `/api/public/${b.slug}/appointments/${bToken}`)).status).toBe(200);
  });
});

describe("prazo de cancelamento", () => {
  it("depois do prazo, cancelar e remarcar dão 409 deadline_passed e nada muda; dentro do prazo, funciona", async () => {
    const created = await book(a, at(dayPlus(3), "10:00"));
    expect(created.status).toBe(201);
    const base = `/api/public/${a.slug}/appointments/${created.body.manageToken}`;
    try {
      // Prazo de 30 dias: o agendamento daqui a 3 dias já passou do prazo.
      await setSettings(a, { cancelDeadlineMinutes: 43_200 });
      const view = await pub("GET", base);
      expect(view.status).toBe(200);
      expect(view.body.appointment.canManage).toBe(false);
      const before = await snapshot(a);
      await expectError(pub("POST", `${base}/cancel`), 409, "deadline_passed");
      await expectError(pub("POST", `${base}/reschedule`, { body: { startsAt: at(dayPlus(3), "13:00") } }), 409, "deadline_passed");
      expect(await snapshot(a)).toEqual(before);

      // Prazo de 3 dias menos 1 hora: ainda dentro.
      const until = new Date(at(dayPlus(3), "10:00")).getTime() - Date.now();
      await setSettings(a, { cancelDeadlineMinutes: Math.floor(until / 60_000) - 60 });
      expect((await pub("GET", base)).body.appointment.canManage).toBe(true);
      expect((await pub("POST", `${base}/cancel`)).status).toBe(200);
    } finally {
      await setSettings(a, { cancelDeadlineMinutes: 120 });
    }
  });
});

describe("limite de requisições por IP", () => {
  it("escrita: o 11º pedido do mesmo IP em 10 min dá 429 com Retry-After; outro IP segue", async () => {
    const ip = newIp();
    expect(PUBLIC_RATE_LIMITS.write.max).toBe(10);
    for (let i = 0; i < PUBLIC_RATE_LIMITS.write.max; i += 1) {
      // Corpos inválidos também contam: o limite vem antes da validação.
      const result = await pub("POST", `/api/public/${a.slug}/appointments`, { ip, body: {} });
      expect(result.status).toBe(400);
    }
    const before = await snapshot(a);
    const blocked = await expectError(book(a, at(DAY, "13:00"), {}, ip), 429, "rate_limited");
    expect(blocked.headers.get("Retry-After")).toBe("600");
    expect(blocked.headers.get("Referrer-Policy")).toBe("no-referrer");
    await expectError(pub("POST", `/api/public/${a.slug}/appointments/${fakeToken()}/cancel`, { ip }), 429, "rate_limited");
    // Vale para qualquer slug, inclusive inexistente (não dá para varrer slugs por fora do limite).
    await expectError(pub("POST", `/api/public/nao-existe-xyz/appointments`, { ip, body: {} }), 429, "rate_limited");
    expect(await snapshot(a)).toEqual(before);
    // Leitura do mesmo IP tem balde próprio; outro IP escreve normalmente.
    expect((await pub("GET", `/api/public/${a.slug}`, { ip })).status).toBe(200);
    expect((await pub("POST", `/api/public/${a.slug}/appointments`, { body: {} })).status).toBe(400);
  });

  it("leitura: passado o teto de 120 por minuto, site, horários e link dão 429", async () => {
    const ip = newIp();
    await prisma.rateLimitHit.createMany({
      data: Array.from({ length: PUBLIC_RATE_LIMITS.read.max }, () => ({ bucket: PUBLIC_RATE_LIMITS.read.bucket, key: ip })),
    });
    for (const path of [
      `/api/public/${a.slug}`,
      `/api/public/${a.slug}/availability?serviceId=${a.serviceId}&date=${DAY}`,
      `/api/public/${a.slug}/appointments/${fakeToken()}`,
    ]) {
      const result = await expectError(pub("GET", path, { ip }), 429, "rate_limited");
      expect(result.headers.get("Retry-After")).toBe("60");
    }
  });

  it("janela móvel: registros antigos saem da conta e são apagados", async () => {
    const repo = createRateLimitRepository();
    const key = newIp();
    const limit = { bucket: "test_bucket", key, max: 2, windowMs: 60_000 };
    const t0 = new Date("2026-01-01T12:00:00Z");
    expect(await repo.hit(limit, t0)).toBe(true);
    expect(await repo.hit(limit, new Date(t0.getTime() + 1_000))).toBe(true);
    expect(await repo.hit(limit, new Date(t0.getTime() + 2_000))).toBe(false);
    // Recusado também conta: em +30 s há 4 na janela.
    expect(await repo.hit(limit, new Date(t0.getTime() + 30_000))).toBe(false);
    // Em +70 s, só +30 s e +70 s estão na janela de 60 s: volta a passar.
    expect(await repo.hit(limit, new Date(t0.getTime() + 70_000))).toBe(true);
    // Passada a janela inteira, só o registro novo sobra (os antigos foram apagados).
    expect(await repo.hit(limit, new Date(t0.getTime() + 200_000))).toBe(true);
    expect(await prisma.rateLimitHit.count({ where: { bucket: "test_bucket", key } })).toBe(1);
    await prisma.rateLimitHit.deleteMany({ where: { bucket: "test_bucket", key } });
  });
});

describe("concorrência entre clientes (D8)", () => {
  it("dois clientes no mesmo horário ao mesmo tempo: um confirma, o outro recebe 409 e o horário some", async () => {
    const startsAt = at(dayPlus(9), "10:00");
    const results = await Promise.all([book(a, startsAt), book(a, startsAt)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("slot_unavailable");
    expect(await confirmedAt(a, startsAt)).toBe(1);
    expect(await slotTimes(a, dayPlus(9))).not.toContain("10:00");
  });

  it("cinco clientes no mesmo horário: um só vence", async () => {
    const startsAt = at(dayPlus(9), "14:00");
    const results = await Promise.all(Array.from({ length: 5 }, () => book(a, startsAt)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await confirmedAt(a, startsAt)).toBe(1);
  });

  it("\"qualquer profissional\" com dois livres: três clientes simultâneos, dois confirmam em profissionais diferentes", async () => {
    const startsAt = at(dayPlus(10), "10:00");
    const results = await Promise.all(Array.from({ length: 3 }, () => book(a, startsAt, { professionalId: null })));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(new Set(ok.map((r) => r.body.appointment.professional.id)).size).toBe(2);
    expect(await confirmedAt(a, startsAt)).toBe(2);
  });

  it("duas remarcações simultâneas para o mesmo horário: uma vence e a outra fica onde estava", async () => {
    const day = dayPlus(11);
    const first = await book(a, at(day, "09:00"));
    const second = await book(a, at(day, "11:00"));
    const target = at(day, "15:00");
    const results = await Promise.all(
      [first, second].map((r) => pub("POST", `/api/public/${a.slug}/appointments/${r.body.manageToken}/reschedule`, { body: { startsAt: target } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await confirmedAt(a, target)).toBe(1);
    const loser = results.findIndex((r) => r.status === 409);
    const original = [at(day, "09:00"), at(day, "11:00")][loser];
    expect(await confirmedAt(a, original)).toBe(1);
  });
});

describe("nenhuma rota pública aceita tenantId do cliente", () => {
  it("tenantId na consulta, em cabeçalho forjado ou sessão do dono B não troca o negócio do slug", async () => {
    const forged = { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: b.tenantId, "x-tenant-id": b.tenantId };
    const site = await pub("GET", `/api/public/${a.slug}?tenantId=${b.tenantId}`, { token: b.token, headers: forged });
    expect(site.status).toBe(200);
    expect(site.body.business.slug).toBe(a.slug);
    expect(JSON.stringify(site.body)).not.toContain(b.serviceId);

    const availability = await pub("GET", `/api/public/${a.slug}/availability?serviceId=${a.serviceId}&date=${DAY}&tenantId=${b.tenantId}`, { token: b.token, headers: forged });
    expect(availability.status).toBe(200);
    await expectError(
      pub("GET", `/api/public/${a.slug}/availability?serviceId=${b.serviceId}&date=${DAY}&tenantId=${b.tenantId}`, { token: b.token, headers: forged }),
      404,
      "not_found",
    );

    // Com a sessão do dono B e o cabeçalho forjado, o agendamento cai no A (do slug) e um ID do B não passa.
    const created = await pub("POST", `/api/public/${a.slug}/appointments`, { token: b.token, headers: forged, body: bookingBody(a, at(dayPlus(12), "10:00")) });
    expect(created.status).toBe(201);
    const row = await prisma.appointment.findFirstOrThrow({ where: { manageTokenHash: sha256(created.body.manageToken) } });
    expect(row.tenantId).toBe(a.tenantId);
    await expectError(
      pub("POST", `/api/public/${a.slug}/appointments`, { token: b.token, headers: forged, body: bookingBody(b, at(dayPlus(12), "11:00")) }),
      404,
      "not_found",
    );
    // tenantId no corpo é recusado (corpo estrito).
    await expectError(
      pub("POST", `/api/public/${a.slug}/appointments`, { body: { ...bookingBody(a, at(dayPlus(12), "12:00")), tenantId: a.tenantId } }),
      400,
      "invalid_input",
    );
  });

  it("o código das rotas públicas não lê sessão, cabeçalho de tenant nem tenantId", () => {
    const dir = join(process.cwd(), "src", "app", "api", "public");
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((file) => file.endsWith(".ts"));
    expect(files).toHaveLength(Object.keys(PUBLIC_ROUTES).length);
    const sources = [...files.map((file) => join(dir, file)), join(process.cwd(), "src", "server", "http", "public-route.ts")];
    for (const file of sources) {
      const code = readFileSync(file, "utf8");
      for (const forbidden of ["getAuthContext", "TENANT_ID_HEADER", "tenantRoute(", "searchParams.get(\"tenantId\")", "body.tenantId"]) {
        expect(code, `${file} usa ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("cabeçalhos contra vazamento do token", () => {
  it("toda resposta pública sai com no-referrer, no-store e noindex, inclusive erros", async () => {
    const created = await book(a, at(dayPlus(13), "10:00"));
    const responses = [
      created,
      await pub("GET", `/api/public/${a.slug}`),
      await pub("GET", `/api/public/${a.slug}/appointments/${created.body.manageToken}`),
      await pub("GET", `/api/public/${a.slug}/appointments/${fakeToken()}`),
      await pub("GET", `/api/public/nao-existe-xyz`),
      await pub("POST", `/api/public/${a.slug}/appointments`, { body: {} }),
      await pub("POST", `/api/public/${a.slug}/appointments/${created.body.manageToken}/cancel`),
    ];
    for (const response of responses) {
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("next.config aplica os mesmos cabeçalhos na página /{slug}/agendamento/{token} e na API pública", async () => {
    const rules = await nextConfig.headers!();
    const page = rules.find((rule) => rule.source === "/:slug/agendamento/:token");
    const api = rules.find((rule) => rule.source === "/api/public/:path*");
    for (const rule of [page, api]) {
      expect(rule).toBeDefined();
      const headers = Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
      expect(headers["Referrer-Policy"]).toBe("no-referrer");
      expect(headers["Cache-Control"]).toContain("no-store");
    }
  });
});
