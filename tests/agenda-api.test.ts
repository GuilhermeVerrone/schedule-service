import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import * as professionalsRoute from "@/app/api/professionals/route";
import * as professionalArchiveRoute from "@/app/api/professionals/[id]/archive/route";
import * as professionalServicesRoute from "@/app/api/professionals/[id]/services/route";
import * as professionalWorkingHoursRoute from "@/app/api/professionals/[id]/working-hours/route";
import * as servicesRoute from "@/app/api/services/route";
import * as serviceArchiveRoute from "@/app/api/services/[id]/archive/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as appointmentsRoute from "@/app/api/appointments/route";
import * as appointmentRoute from "@/app/api/appointments/[id]/route";
import * as appointmentCancelRoute from "@/app/api/appointments/[id]/cancel/route";
import * as appointmentCompleteRoute from "@/app/api/appointments/[id]/complete/route";
import * as appointmentRescheduleRoute from "@/app/api/appointments/[id]/reschedule/route";
import * as timeBlocksRoute from "@/app/api/time-blocks/route";
import * as timeBlockRoute from "@/app/api/time-blocks/[id]/route";
import * as availabilityRoute from "@/app/api/availability/route";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { apiRequest, cleanupAuthData, sessionCookieOf, uniqueEmail } from "./helpers/auth";
import { createRouteCaller, HTTP_METHODS, type CallOptions, type Method, type RouteModule } from "./helpers/api-routes";

// Fase 4 (agenda-link-publico): API do painel para configurações, agenda, agendamento manual,
// cancelar/remarcar/concluir, bloqueios e horários calculados (guia 5, 6, 7d, 7e, 9; D3, D4, D8, D9).
// Toda requisição passa pelo proxy de verdade antes do handler. Banco: branch test do Neon.

const PASSWORD = "senha-forte-123";
const TZ = "America/Sao_Paulo";

// Rotas desta fase: o teste de cobertura confere que são exatamente as da árvore src/app/api.
const AGENDA_ROUTES = {
  "/api/settings": settingsRoute,
  "/api/appointments": appointmentsRoute,
  "/api/appointments/[id]": appointmentRoute,
  "/api/appointments/[id]/cancel": appointmentCancelRoute,
  "/api/appointments/[id]/complete": appointmentCompleteRoute,
  "/api/appointments/[id]/reschedule": appointmentRescheduleRoute,
  "/api/time-blocks": timeBlocksRoute,
  "/api/time-blocks/[id]": timeBlockRoute,
  "/api/availability": availabilityRoute,
} as unknown as Record<string, RouteModule>;

// Rotas do catálogo (Fatia 1) usadas só para montar os dados de teste.
const SETUP_ROUTES = {
  "/api/professionals": professionalsRoute,
  "/api/professionals/[id]/archive": professionalArchiveRoute,
  "/api/professionals/[id]/services": professionalServicesRoute,
  "/api/professionals/[id]/working-hours": professionalWorkingHoursRoute,
  "/api/services": servicesRoute,
  "/api/services/[id]/archive": serviceArchiveRoute,
} as unknown as Record<string, RouteModule>;

const { call, matchRoute } = createRouteCaller({ ...AGENDA_ROUTES, ...SETUP_ROUTES });

async function expectError(promise: ReturnType<typeof call>, status: number, code: string) {
  const { status: actual, body } = await promise;
  expect({ status: actual, code: body?.error?.code }).toEqual({ status, code });
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
  return body.error as { code: string; message: string };
}

// Dia local do tenant daqui a N dias e instante ISO de um horário local nesse dia.
const dayPlus = (days: number): string => DateTime.now().setZone(TZ).startOf("day").plus({ days }).toISODate()!;
const at = (date: string, time: string): string =>
  DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toUTC().toISO()!;
const localTime = (iso: string): string => DateTime.fromISO(iso, { zone: TZ }).toFormat("HH:mm");

const DAY = dayPlus(7);

interface Account {
  token: string;
  tenantId: string;
  professionalId: string;
  otherProfessionalId: string;
  serviceId: string;
}

// Conta com dois profissionais (08:00-18:00 todos os dias) que atendem um serviço de 60 min.
async function setupAccount(businessName: string): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName, email: uniqueEmail("agenda"), password: PASSWORD },
    }),
  );
  expect(response.status).toBe(201);
  const token = sessionCookieOf(response)!.value;
  const tenantId = (await response.json()).tenant.id as string;
  const service = await call("POST", "/api/services", {
    token,
    body: { name: `Corte ${businessName}`, durationMinutes: 60, priceCents: 5000 },
  });
  const ids: string[] = [];
  for (const name of [`Ana ${businessName}`, `Bia ${businessName}`]) {
    const professional = await call("POST", "/api/professionals", { token, body: { name } });
    const id = professional.body.professional.id as string;
    await call("PUT", `/api/professionals/${id}/services`, { token, body: { serviceIds: [service.body.service.id] } });
    const intervals = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "08:00", end: "18:00" }));
    const wh = await call("PUT", `/api/professionals/${id}/working-hours`, { token, body: { intervals } });
    expect(wh.status).toBe(200);
    ids.push(id);
  }
  return { token, tenantId, professionalId: ids[0], otherProfessionalId: ids[1], serviceId: service.body.service.id };
}

let phoneSeq = 0;
const nextPhone = () => `(11) 9${String(10_000_000 + ++phoneSeq).slice(-8)}`;

function book(account: Account, startsAt: string, extra: Record<string, unknown> = {}) {
  return call("POST", "/api/appointments", {
    token: account.token,
    body: {
      professionalId: account.professionalId,
      serviceId: account.serviceId,
      startsAt,
      contact: { name: "Cliente Teste", phone: nextPhone() },
      ...extra,
    },
  });
}

async function slotTimes(account: Account, date = DAY, professionalId: string | null = account.professionalId) {
  const query = new URLSearchParams({ serviceId: account.serviceId, date });
  if (professionalId) query.set("professionalId", professionalId);
  const result = await call("GET", `/api/availability?${query}`, { token: account.token });
  expect(result.status).toBe(200);
  return (result.body.slots as { startsAt: string }[]).map((slot) => localTime(slot.startsAt));
}

let a: Account;
let b: Account;

beforeAll(async () => {
  [a, b] = await Promise.all([setupAccount("Estúdio A"), setupAccount("Estúdio B")]);
});

afterAll(async () => {
  await cleanupAuthData();
  await prisma.$disconnect();
});

describe("cobertura", () => {
  it("AGENDA_ROUTES são as rotas da árvore src/app/api fora do catálogo, de auth e da API pública", () => {
    const catalog = ["/api/professionals", "/api/services", "/api/working-hours"];
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[])
      .filter((file) => file.split(sep).at(-1) === "route.ts")
      .map((file) => ["/api", ...file.split(sep).slice(0, -1)].join("/"))
      .filter((route) => !route.startsWith("/api/auth") && !catalog.some((prefix) => route.startsWith(prefix)))
      // A API pública (Fase 5) tem a própria tabela em tests/public-api.test.ts.
      .filter((route) => !route.startsWith("/api/public/"))
      // A API do WhatsApp (whatsapp-conexao-mensagens) tem a própria tabela em tests/whatsapp-api.test.ts.
      .filter((route) => !["/api/whatsapp", "/api/conversations", "/api/webhooks"].some((p) => route.startsWith(p)))
      // A rota de saúde (fila-envio-limites-elegibilidade) é pública e testada em tests/health-route.test.ts.
      .filter((route) => route !== "/api/health")
      // Templates de mensagem (fila-envio-limites-elegibilidade) têm a própria tabela em
      // tests/outbound-panel-api.test.ts.
      .filter((route) => !route.startsWith("/api/message-templates"))
      .sort();
    expect(routes).toEqual(Object.keys(AGENDA_ROUTES).sort());
  });
});

// A normalização do telefone tem testes próprios em tests/phone.test.ts.

describe("configurações (guia 7e; D2, D3)", () => {
  it("GET devolve dados do negócio e os padrões da agenda", async () => {
    const { status, body } = await call("GET", "/api/settings", { token: a.token });
    expect(status).toBe(200);
    expect(body.settings).toMatchObject({
      name: "Estúdio A",
      timezone: TZ,
      description: null,
      address: null,
      phone: null,
      slotStepMinutes: 15,
      bufferMinutes: 0,
      minAdvanceMinutes: 120,
      maxWindowDays: 60,
      cancelDeadlineMinutes: 120,
    });
    expect(Object.keys(body.settings).sort()).toEqual(
      [
        "address", "bufferMinutes", "cancelDeadlineMinutes", "description", "maxWindowDays",
        "minAdvanceMinutes", "name", "phone", "slotStepMinutes", "slug", "timezone",
      ].sort(),
    );
  });

  it("PATCH salva parcialmente; texto vazio limpa o campo", async () => {
    const saved = await call("PATCH", "/api/settings", {
      token: a.token,
      body: { description: "  Cortes e barba  ", address: "Rua A, 10", phone: "(11) 3333-4444", cancelDeadlineMinutes: 60 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({
      description: "Cortes e barba",
      address: "Rua A, 10",
      phone: "(11) 3333-4444",
      cancelDeadlineMinutes: 60,
      slotStepMinutes: 15,
    });
    const cleared = await call("PATCH", "/api/settings", { token: a.token, body: { address: "" } });
    expect(cleared.body.settings.address).toBeNull();
    expect(cleared.body.settings.description).toBe("Cortes e barba");
    const reread = await call("GET", "/api/settings", { token: a.token });
    expect(reread.body.settings).toEqual(cleared.body.settings);
    await call("PATCH", "/api/settings", { token: a.token, body: { description: "", phone: "", cancelDeadlineMinutes: 120 } });
  });

  it("entradas inválidas: 400 invalid_input e nada muda", async () => {
    const before = (await call("GET", "/api/settings", { token: a.token })).body.settings;
    const invalid: unknown[] = [
      {},
      { slug: "outro-slug" },
      { name: "Outro nome" },
      { timezone: "UTC" },
      { tenantId: b.tenantId },
      { slotStepMinutes: 7 },
      { slotStepMinutes: 0 },
      { slotStepMinutes: "15" },
      { bufferMinutes: -5 },
      { bufferMinutes: 125 },
      { minAdvanceMinutes: 1.5 },
      { maxWindowDays: 0 },
      { maxWindowDays: 366 },
      { cancelDeadlineMinutes: 43_201 },
      { description: "x".repeat(1001) },
      { slotStepMinutes: 30, slug: "mistura-valida-e-invalida" },
    ];
    for (const body of invalid) {
      await expectError(call("PATCH", "/api/settings", { token: a.token, body }), 400, "invalid_input");
    }
    await expectError(call("PATCH", "/api/settings", { token: a.token, rawBody: "{quebrado" }), 400, "invalid_input");
    expect((await call("GET", "/api/settings", { token: a.token })).body.settings).toEqual(before);
  });

  it("mudar os parâmetros muda os horários calculados", async () => {
    const c = await setupAccount("Estúdio Parâmetros");
    const patch = (body: Record<string, number>) => call("PATCH", "/api/settings", { token: c.token, body });

    // Padrão: passo 15, serviço de 60 min, 08:00-18:00 -> 08:00 ... 17:00.
    let slots = await slotTimes(c);
    expect(slots.slice(0, 3)).toEqual(["08:00", "08:15", "08:30"]);
    expect(slots.at(-1)).toBe("17:00");
    expect(slots).toHaveLength(37);

    // Passo da grade.
    expect((await patch({ slotStepMinutes: 30 })).status).toBe(200);
    slots = await slotTimes(c);
    expect(slots.slice(0, 3)).toEqual(["08:00", "08:30", "09:00"]);
    expect(slots).toHaveLength(19);

    // Buffer em volta de um agendamento 10:00-11:00.
    expect((await book(c, at(DAY, "10:00"))).status).toBe(201);
    expect(await slotTimes(c)).toEqual(expect.arrayContaining(["09:00", "11:00"]));
    expect((await patch({ bufferMinutes: 30 })).status).toBe(200);
    slots = await slotTimes(c);
    expect(slots).not.toContain("09:00");
    expect(slots).not.toContain("11:00");
    expect(slots).toEqual(expect.arrayContaining(["08:30", "11:30"]));

    // Janela máxima: o dia D+7 sai da janela de 5 dias.
    expect((await patch({ maxWindowDays: 5 })).status).toBe(200);
    expect(await slotTimes(c)).toEqual([]);
    expect(await slotTimes(c, dayPlus(3))).not.toEqual([]);
    await patch({ maxWindowDays: 60 });

    // Antecedência mínima de 30 dias zera D+7 e mantém D+40.
    expect((await patch({ minAdvanceMinutes: 43_200 })).status).toBe(200);
    expect(await slotTimes(c)).toEqual([]);
    expect(await slotTimes(c, dayPlus(40))).not.toEqual([]);

    // De volta aos padrões: a grade de 15 min volta, sem o horário ocupado.
    await patch({ minAdvanceMinutes: 120, bufferMinutes: 0, slotStepMinutes: 15 });
    slots = await slotTimes(c);
    expect(slots).toContain("09:00");
    expect(slots).not.toContain("09:15");
    expect(slots).not.toContain("10:45");
    expect(slots).toContain("11:00");
  });
});

describe("agendamento manual e agenda (guia 7d; D4, D9)", () => {
  it("cria com fim pela duração do serviço, telefone normalizado e sem token de gestão", async () => {
    const created = await book(a, at(DAY, "09:00"), {
      contact: { name: "  Maria Silva ", phone: "(11) 98765-0001", email: "maria@exemplo.com" },
    });
    expect(created.status).toBe(201);
    const appointment = created.body.appointment;
    expect(appointment).toMatchObject({
      status: "confirmed",
      startsAt: at(DAY, "09:00"),
      endsAt: at(DAY, "10:00"),
      canceledAt: null,
      professional: { id: a.professionalId },
      service: { id: a.serviceId, durationMinutes: 60 },
      contact: { name: "Maria Silva", phone: "+5511987650001" },
    });
    expect(JSON.stringify(created.body)).not.toMatch(/manageTokenHash|tenantId/);
    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row).toMatchObject({ tenantId: a.tenantId, manageTokenHash: null });
    const contact = await prisma.contact.findUnique({ where: { id: appointment.contact.id } });
    expect(contact).toMatchObject({ email: "maria@exemplo.com", consentAt: null });

    const read = await call("GET", `/api/appointments/${appointment.id}`, { token: a.token });
    expect(read.status).toBe(200);
    expect(read.body.appointment).toEqual(appointment);

    // O mesmo telefone, com outra máscara, reencontra o cliente.
    const again = await book(a, at(DAY, "09:00"), {
      professionalId: a.otherProfessionalId,
      contact: { name: "Outro Nome", phone: "+55 11 98765-0001" },
    });
    expect(again.status).toBe(201);
    expect(again.body.appointment.contact).toEqual(appointment.contact);
  });

  it("lista a agenda por intervalo, por início, com filtros de profissional e status", async () => {
    const day = dayPlus(8);
    const first = await book(a, at(day, "08:00"));
    const second = await book(a, at(day, "13:00"), { professionalId: a.otherProfessionalId });
    const third = await book(a, at(day, "15:00"));
    await call("POST", `/api/appointments/${third.body.appointment.id}/cancel`, { token: a.token });

    const range = new URLSearchParams({ from: at(day, "00:00"), to: at(dayPlus(9), "00:00") });
    const all = await call("GET", `/api/appointments?${range}`, { token: a.token });
    expect(all.status).toBe(200);
    expect(all.body.appointments.map((x: { id: string }) => x.id)).toEqual([
      first.body.appointment.id,
      second.body.appointment.id,
      third.body.appointment.id,
    ]);

    range.set("status", "confirmed");
    const confirmed = await call("GET", `/api/appointments?${range}`, { token: a.token });
    expect(confirmed.body.appointments).toHaveLength(2);
    range.set("professionalId", a.otherProfessionalId);
    const byProfessional = await call("GET", `/api/appointments?${range}`, { token: a.token });
    expect(byProfessional.body.appointments.map((x: { id: string }) => x.id)).toEqual([second.body.appointment.id]);

    // Intervalo que corta o agendamento no meio ainda o traz (cruza a janela).
    const partial = new URLSearchParams({ from: at(day, "08:30"), to: at(day, "08:45") });
    const cut = await call("GET", `/api/appointments?${partial}`, { token: a.token });
    expect(cut.body.appointments.map((x: { id: string }) => x.id)).toEqual([first.body.appointment.id]);
  });

  it("consulta de intervalo inválida: 400", async () => {
    const queries = [
      "",
      `from=${encodeURIComponent(at(DAY, "10:00"))}`,
      `from=${encodeURIComponent(at(DAY, "10:00"))}&to=${encodeURIComponent(at(DAY, "09:00"))}`,
      `from=${encodeURIComponent(at(DAY, "10:00"))}&to=${encodeURIComponent(at(DAY, "10:00"))}`,
      `from=${encodeURIComponent(at(DAY, "00:00"))}&to=${encodeURIComponent(at(dayPlus(7 + 63), "00:00"))}`,
      `from=ontem&to=amanha`,
      `from=2026-10-20T10:00:00&to=2026-10-21T10:00:00`,
      `from=${encodeURIComponent(at(DAY, "00:00"))}&to=${encodeURIComponent(at(dayPlus(8), "00:00"))}&status=pendente`,
    ];
    for (const query of queries) {
      await expectError(call("GET", `/api/appointments?${query}`, { token: a.token }), 400, "invalid_input");
      if (!query.includes("status")) {
        await expectError(call("GET", `/api/time-blocks?${query}`, { token: a.token }), 400, "invalid_input");
      }
    }
  });

  it("horário ocupado ou fora da agenda: 409 e nada é gravado", async () => {
    const day = dayPlus(10);
    expect((await book(a, at(day, "10:00"))).status).toBe(201);
    await call("POST", "/api/time-blocks", {
      token: a.token,
      body: { professionalId: a.professionalId, startsAt: at(day, "14:00"), endsAt: at(day, "15:00") },
    });
    const before = await prisma.appointment.count({ where: { tenantId: a.tenantId } });
    const contactsBefore = await prisma.contact.count({ where: { tenantId: a.tenantId } });

    for (const time of ["10:00", "10:30", "09:15"]) {
      await expectError(book(a, at(day, time)), 409, "slot_unavailable");
    }
    await expectError(book(a, at(day, "07:00")), 409, "slot_unavailable"); // antes do expediente
    await expectError(book(a, at(day, "17:30")), 409, "slot_unavailable"); // termina depois das 18:00
    await expectError(book(a, at(day, "11:07")), 409, "slot_unavailable"); // fora da grade
    await expectError(book(a, at(day, "13:30")), 409, "slot_unavailable"); // atravessa o bloqueio
    await expectError(book(a, at(dayPlus(-1), "10:00")), 409, "slot_unavailable"); // passado

    expect(await prisma.appointment.count({ where: { tenantId: a.tenantId } })).toBe(before);
    expect(await prisma.contact.count({ where: { tenantId: a.tenantId } })).toBe(contactsBefore);
    // Outro profissional no mesmo horário pode.
    expect((await book(a, at(day, "10:00"), { professionalId: a.otherProfessionalId })).status).toBe(201);
  });

  it("o dono agenda sem antecedência mínima nem janela máxima do cliente", async () => {
    const c = await setupAccount("Estúdio Encaixe");
    await call("PATCH", "/api/settings", { token: c.token, body: { minAdvanceMinutes: 43_200, maxWindowDays: 3 } });
    expect(await slotTimes(c)).toEqual([]);
    expect((await book(c, at(DAY, "10:00"))).status).toBe(201);
    expect((await book(c, at(dayPlus(200), "10:00"))).status).toBe(201);
  });

  it("serviço ou profissional arquivado, ou sem vínculo: 422 not_bookable", async () => {
    const c = await setupAccount("Estúdio Arquivo");
    const unlinked = await call("POST", "/api/services", {
      token: c.token,
      body: { name: "Sem vínculo", durationMinutes: 30, priceCents: 0 },
    });
    await expectError(book(c, at(DAY, "10:00"), { serviceId: unlinked.body.service.id }), 422, "not_bookable");
    await call("POST", `/api/professionals/${c.otherProfessionalId}/archive`, { token: c.token });
    await expectError(book(c, at(DAY, "10:00"), { professionalId: c.otherProfessionalId }), 422, "not_bookable");
    await call("POST", `/api/services/${c.serviceId}/archive`, { token: c.token });
    await expectError(book(c, at(DAY, "10:00")), 422, "not_bookable");
    expect(await prisma.appointment.count({ where: { tenantId: c.tenantId } })).toBe(0);
  });

  it("corpo inválido: 400 invalid_input", async () => {
    const valid = {
      professionalId: a.professionalId,
      serviceId: a.serviceId,
      startsAt: at(DAY, "16:00"),
      contact: { name: "Cliente", phone: "11987650002" },
    };
    const invalid: unknown[] = [
      {},
      { ...valid, contact: undefined },
      { ...valid, contact: { name: "C", phone: "11987650002" } },
      { ...valid, contact: { name: "Cliente" } },
      { ...valid, contact: { name: "Cliente", phone: "123" } },
      { ...valid, contact: { name: "Cliente", phone: "11987650002", email: "nao-e-email" } },
      { ...valid, startsAt: "2026-10-20T10:00" },
      { ...valid, startsAt: "amanhã" },
      { ...valid, professionalId: undefined },
      { ...valid, serviceId: "" },
    ];
    const before = await prisma.appointment.count({ where: { tenantId: a.tenantId } });
    for (const body of invalid) {
      await expectError(call("POST", "/api/appointments", { token: a.token, body }), 400, "invalid_input");
    }
    await expectError(call("POST", "/api/appointments", { token: a.token, rawBody: "{" }), 400, "invalid_input");
    expect(await prisma.appointment.count({ where: { tenantId: a.tenantId } })).toBe(before);
    // IDs que não existem (ou malformados): 404.
    const missing = "0190a1b2-0000-7000-8000-000000000000";
    await expectError(call("POST", "/api/appointments", { token: a.token, body: { ...valid, serviceId: missing } }), 404, "not_found");
    await expectError(call("POST", "/api/appointments", { token: a.token, body: { ...valid, professionalId: "abc" } }), 404, "not_found");
    for (const path of [`/api/appointments/${missing}`, "/api/appointments/abc"]) {
      await expectError(call("GET", path, { token: a.token }), 404, "not_found");
      await expectError(call("POST", `${path}/cancel`, { token: a.token }), 404, "not_found");
      await expectError(call("POST", `${path}/complete`, { token: a.token }), 404, "not_found");
      await expectError(call("POST", `${path}/reschedule`, { token: a.token, body: { startsAt: at(DAY, "16:00") } }), 404, "not_found");
    }
  });
});

describe("cancelar, concluir e remarcar (D4)", () => {
  it("cancelar libera o horário; cancelar de novo devolve o mesmo; cancelado não conclui nem remarca", async () => {
    const day = dayPlus(12);
    const created = await book(a, at(day, "10:00"));
    const id = created.body.appointment.id;
    expect(await slotTimes(a, day)).not.toContain("10:00");

    const canceled = await call("POST", `/api/appointments/${id}/cancel`, { token: a.token });
    expect(canceled.status).toBe(200);
    expect(canceled.body.appointment.status).toBe("canceled");
    expect(canceled.body.appointment.canceledAt).not.toBeNull();
    expect(await slotTimes(a, day)).toContain("10:00");

    const twice = await call("POST", `/api/appointments/${id}/cancel`, { token: a.token });
    expect(twice.status).toBe(200);
    expect(twice.body.appointment.canceledAt).toBe(canceled.body.appointment.canceledAt);

    await expectError(call("POST", `/api/appointments/${id}/complete`, { token: a.token }), 409, "invalid_status");
    await expectError(
      call("POST", `/api/appointments/${id}/reschedule`, { token: a.token, body: { startsAt: at(day, "12:00") } }),
      409,
      "invalid_status",
    );
    // O horário liberado aceita outro agendamento.
    expect((await book(a, at(day, "10:00"))).status).toBe(201);
  });

  it("concluir: só a partir de confirmado; concluído não cancela e não ocupa horário", async () => {
    const day = dayPlus(13);
    const id = (await book(a, at(day, "10:00"))).body.appointment.id;
    const done = await call("POST", `/api/appointments/${id}/complete`, { token: a.token });
    expect(done.status).toBe(200);
    expect(done.body.appointment.status).toBe("completed");
    expect((await call("POST", `/api/appointments/${id}/complete`, { token: a.token })).status).toBe(200);
    await expectError(call("POST", `/api/appointments/${id}/cancel`, { token: a.token }), 409, "invalid_status");
    expect(await slotTimes(a, day)).toContain("10:00");
  });

  it("remarcar: mesmo registro e duração; libera o antigo e ocupa o novo", async () => {
    const day = dayPlus(14);
    const created = (await book(a, at(day, "10:00"))).body.appointment;
    const moved = await call("POST", `/api/appointments/${created.id}/reschedule`, {
      token: a.token,
      body: { startsAt: at(day, "14:00") },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment).toMatchObject({
      id: created.id,
      status: "confirmed",
      startsAt: at(day, "14:00"),
      endsAt: at(day, "15:00"),
      contact: created.contact,
    });
    const slots = await slotTimes(a, day);
    expect(slots).toContain("10:00");
    expect(slots).not.toContain("14:00");

    // Encostado ou sobreposto ao próprio horário: o agendamento não conflita consigo mesmo.
    const shifted = await call("POST", `/api/appointments/${created.id}/reschedule`, {
      token: a.token,
      body: { startsAt: at(day, "14:30") },
    });
    expect(shifted.status).toBe(200);

    // Trocar de profissional junto.
    const other = await call("POST", `/api/appointments/${created.id}/reschedule`, {
      token: a.token,
      body: { startsAt: at(day, "09:00"), professionalId: a.otherProfessionalId },
    });
    expect(other.status).toBe(200);
    expect(other.body.appointment.professional.id).toBe(a.otherProfessionalId);
  });

  it("remarcar para horário ocupado, fora da agenda ou inválido: erro e nada muda", async () => {
    const day = dayPlus(15);
    const target = (await book(a, at(day, "10:00"))).body.appointment;
    await book(a, at(day, "12:00"));
    const before = await prisma.appointment.findUnique({ where: { id: target.id } });
    const reschedule = (body: unknown) =>
      call("POST", `/api/appointments/${target.id}/reschedule`, { token: a.token, body });

    await expectError(reschedule({ startsAt: at(day, "12:30") }), 409, "slot_unavailable");
    await expectError(reschedule({ startsAt: at(day, "11:30") }), 409, "slot_unavailable");
    await expectError(reschedule({ startsAt: at(day, "06:00") }), 409, "slot_unavailable");
    await expectError(reschedule({ startsAt: at(day, "10:10") }), 409, "slot_unavailable");
    await expectError(reschedule({}), 400, "invalid_input");
    await expectError(reschedule({ startsAt: "10:00" }), 400, "invalid_input");
    await expectError(reschedule({ startsAt: at(day, "15:00"), professionalId: b.professionalId }), 404, "not_found");

    const c = await call("POST", "/api/services", { token: a.token, body: { name: "Só Ana", durationMinutes: 30, priceCents: 0 } });
    await call("PUT", `/api/professionals/${a.professionalId}/services`, {
      token: a.token,
      body: { serviceIds: [a.serviceId, c.body.service.id] },
    });
    const onlyAna = await book(a, at(day, "16:00"), { serviceId: c.body.service.id });
    expect(onlyAna.status).toBe(201);
    expect(onlyAna.body.appointment.endsAt).toBe(at(day, "16:30"));
    await expectError(
      call("POST", `/api/appointments/${onlyAna.body.appointment.id}/reschedule`, {
        token: a.token,
        body: { startsAt: at(day, "16:00"), professionalId: a.otherProfessionalId },
      }),
      422,
      "not_bookable",
    );

    expect(await prisma.appointment.findUnique({ where: { id: target.id } })).toEqual(before);
  });
});

describe("concorrência (D8): pedidos simultâneos no mesmo horário, um só vence", () => {
  it("cinco agendamentos manuais simultâneos: um 201, os outros 409", async () => {
    const startsAt = at(dayPlus(20), "10:00");
    const results = await Promise.all(Array.from({ length: 5 }, () => book(a, startsAt)));
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const result of results.filter((r) => r.status === 409)) {
      expect(["appointment_conflict", "slot_unavailable"]).toContain(result.body.error.code);
    }
    const count = await prisma.appointment.count({
      where: { tenantId: a.tenantId, professionalId: a.professionalId, status: "confirmed", startsAt: new Date(startsAt) },
    });
    expect(count).toBe(1);
  });

  it("dois agendamentos sobrepostos (não iguais) ao mesmo tempo: um só entra", async () => {
    const day = dayPlus(21);
    const results = await Promise.all([book(a, at(day, "10:00")), book(a, at(day, "10:30"))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("duas remarcações simultâneas para o mesmo horário: uma vence e a outra fica onde estava", async () => {
    const day = dayPlus(22);
    const first = (await book(a, at(day, "08:00"))).body.appointment;
    const second = (await book(a, at(day, "12:00"))).body.appointment;
    const results = await Promise.all(
      [first, second].map((appointment) =>
        call("POST", `/api/appointments/${appointment.id}/reschedule`, {
          token: a.token,
          body: { startsAt: at(day, "15:00") },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await prisma.appointment.findMany({ where: { id: { in: [first.id, second.id] } } });
    const starts = rows.map((row) => row.startsAt.toISOString()).sort();
    const loser = results[0].status === 409 ? first : second;
    expect(starts).toContain(new Date(at(day, "15:00")).toISOString());
    expect(starts).toContain(new Date(loser.startsAt).toISOString());
  });

  it("agendamento manual e remarcação simultâneos para o mesmo horário: um só vence", async () => {
    const day = dayPlus(23);
    const existing = (await book(a, at(day, "08:00"))).body.appointment;
    const results = await Promise.all([
      book(a, at(day, "11:00")),
      call("POST", `/api/appointments/${existing.id}/reschedule`, { token: a.token, body: { startsAt: at(day, "11:00") } }),
    ]);
    const [created, moved] = results.map((r) => r.status);
    expect([[201, 409], [409, 200]]).toContainEqual([created, moved]);
    const atEleven = await prisma.appointment.count({
      where: { tenantId: a.tenantId, professionalId: a.professionalId, status: "confirmed", startsAt: new Date(at(day, "11:00")) },
    });
    expect(atEleven).toBe(1);
  });
});

describe("bloqueios (D9)", () => {
  it("CRUD: cria, lê, lista por intervalo e remove; o bloqueio tira e devolve horários", async () => {
    const day = dayPlus(25);
    expect(await slotTimes(a, day)).toContain("10:00");
    const created = await call("POST", "/api/time-blocks", {
      token: a.token,
      body: { professionalId: a.professionalId, startsAt: at(day, "10:00"), endsAt: at(day, "12:00"), reason: "  Médico " },
    });
    expect(created.status).toBe(201);
    const block = created.body.timeBlock;
    expect(block).toMatchObject({
      professionalId: a.professionalId,
      startsAt: at(day, "10:00"),
      endsAt: at(day, "12:00"),
      reason: "Médico",
    });
    expect(JSON.stringify(created.body)).not.toContain("tenantId");

    const slots = await slotTimes(a, day);
    expect(slots).not.toContain("09:15"); // o serviço de 60 min cruzaria o bloqueio
    expect(slots).not.toContain("11:00");
    expect(slots).toEqual(expect.arrayContaining(["09:00", "12:00"]));
    expect(await slotTimes(a, day, a.otherProfessionalId)).toContain("10:00");

    expect((await call("GET", `/api/time-blocks/${block.id}`, { token: a.token })).body.timeBlock).toEqual(block);
    const range = new URLSearchParams({ from: at(day, "11:00"), to: at(day, "11:30") });
    const listed = await call("GET", `/api/time-blocks?${range}`, { token: a.token });
    expect(listed.body.timeBlocks.map((x: { id: string }) => x.id)).toEqual([block.id]);
    range.set("professionalId", a.otherProfessionalId);
    expect((await call("GET", `/api/time-blocks?${range}`, { token: a.token })).body.timeBlocks).toEqual([]);

    const removed = await call("DELETE", `/api/time-blocks/${block.id}`, { token: a.token });
    expect(removed.status).toBe(204);
    expect(removed.body).toBeNull();
    await expectError(call("GET", `/api/time-blocks/${block.id}`, { token: a.token }), 404, "not_found");
    await expectError(call("DELETE", `/api/time-blocks/${block.id}`, { token: a.token }), 404, "not_found");
    expect(await slotTimes(a, day)).toContain("10:00");
  });

  it("sem motivo, motivo vazio e bloqueio por cima de agendamento", async () => {
    const day = dayPlus(26);
    await book(a, at(day, "10:00"));
    const noReason = await call("POST", "/api/time-blocks", {
      token: a.token,
      body: { professionalId: a.professionalId, startsAt: at(day, "09:00"), endsAt: at(day, "18:00"), reason: "" },
    });
    expect(noReason.status).toBe(201);
    expect(noReason.body.timeBlock.reason).toBeNull();
    expect(await slotTimes(a, day)).toEqual(["08:00"]);
  });

  it("entradas inválidas: 400; profissional inexistente: 404", async () => {
    const day = dayPlus(27);
    const valid = { professionalId: a.professionalId, startsAt: at(day, "10:00"), endsAt: at(day, "11:00") };
    const invalid: unknown[] = [
      {},
      { ...valid, endsAt: at(day, "10:00") },
      { ...valid, endsAt: at(day, "09:00") },
      { ...valid, startsAt: "2026-10-20 10:00" },
      { ...valid, professionalId: undefined },
      { ...valid, reason: "x".repeat(201) },
      { ...valid, reason: 42 },
    ];
    const before = await prisma.timeBlock.count({ where: { tenantId: a.tenantId } });
    for (const body of invalid) {
      await expectError(call("POST", "/api/time-blocks", { token: a.token, body }), 400, "invalid_input");
    }
    await expectError(
      call("POST", "/api/time-blocks", { token: a.token, body: { ...valid, professionalId: "0190a1b2-0000-7000-8000-000000000000" } }),
      404,
      "not_found",
    );
    expect(await prisma.timeBlock.count({ where: { tenantId: a.tenantId } })).toBe(before);
    await expectError(call("GET", "/api/time-blocks/abc", { token: a.token }), 404, "not_found");
  });
});

describe("horários calculados (GET /api/availability)", () => {
  it("qualquer profissional: une os horários e diz quem está livre", async () => {
    const day = dayPlus(30);
    await book(a, at(day, "10:00"));
    const query = new URLSearchParams({ serviceId: a.serviceId, date: day });
    const result = await call("GET", `/api/availability?${query}`, { token: a.token });
    expect(result.status).toBe(200);
    expect(result.body.date).toBe(day);
    const slots = result.body.slots as { startsAt: string; professionalIds: string[] }[];
    const ten = slots.find((slot) => slot.startsAt === at(day, "10:00"));
    const eight = slots.find((slot) => slot.startsAt === at(day, "08:00"));
    expect(ten?.professionalIds).toEqual([a.otherProfessionalId]);
    expect(eight?.professionalIds.sort()).toEqual([a.professionalId, a.otherProfessionalId].sort());
    // Não expõe dados de cliente nem de agendamento.
    expect(Object.keys(slots[0]).sort()).toEqual(["professionalIds", "startsAt"]);
  });

  it("consulta inválida: 400; serviço ou profissional inexistente: 404", async () => {
    for (const query of ["", `serviceId=${a.serviceId}`, `serviceId=${a.serviceId}&date=20-10-2026`, `serviceId=${a.serviceId}&date=2026-02-30`]) {
      await expectError(call("GET", `/api/availability?${query}`, { token: a.token }), 400, "invalid_input");
    }
    await expectError(
      call("GET", `/api/availability?serviceId=0190a1b2-0000-7000-8000-000000000000&date=${DAY}`, { token: a.token }),
      404,
      "not_found",
    );
  });
});

describe("isolamento por tenant (guia 6, 9)", () => {
  interface BData {
    appointmentId: string;
    canceledAppointmentId: string;
    timeBlockId: string;
  }
  let bData: BData;
  const missing = "0190a1b2-0000-7000-8000-000000000000";

  const snapshotOfB = async () => ({
    tenant: await prisma.tenant.findUnique({ where: { id: b.tenantId } }),
    appointments: await prisma.appointment.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
    contacts: await prisma.contact.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
    timeBlocks: await prisma.timeBlock.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
  });

  beforeAll(async () => {
    const day = dayPlus(40);
    const appointment = await book(b, at(day, "10:00"), { contact: { name: "Cliente do B", phone: "(21) 99999-0001" } });
    const canceled = await book(b, at(day, "14:00"));
    await call("POST", `/api/appointments/${canceled.body.appointment.id}/cancel`, { token: b.token });
    const block = await call("POST", "/api/time-blocks", {
      token: b.token,
      body: { professionalId: b.professionalId, startsAt: at(day, "16:00"), endsAt: at(day, "17:00"), reason: "Bloqueio do B" },
    });
    bData = {
      appointmentId: appointment.body.appointment.id,
      canceledAppointmentId: canceled.body.appointment.id,
      timeBlockId: block.body.timeBlock.id,
    };
  });

  // Toda rota que recebe um id (no caminho ou no corpo/consulta), apontando para dados do B.
  const byIdRoutes = (): [Method, string, unknown?][] => {
    const day = dayPlus(41);
    const appointment = (professionalId: string, serviceId: string) => ({
      professionalId,
      serviceId,
      startsAt: at(day, "10:00"),
      contact: { name: "Invasor", phone: "(11) 90000-0001" },
    });
    return [
      ["GET", `/api/appointments/${bData.appointmentId}`],
      ["POST", `/api/appointments/${bData.appointmentId}/cancel`],
      ["POST", `/api/appointments/${bData.appointmentId}/complete`],
      ["POST", `/api/appointments/${bData.canceledAppointmentId}/complete`],
      ["POST", `/api/appointments/${bData.appointmentId}/reschedule`, { startsAt: at(day, "11:00") }],
      ["POST", `/api/appointments/${bData.appointmentId}/reschedule`, { startsAt: at(day, "11:00"), professionalId: a.professionalId }],
      ["POST", "/api/appointments", appointment(b.professionalId, b.serviceId)],
      ["POST", "/api/appointments", appointment(a.professionalId, b.serviceId)],
      ["POST", "/api/appointments", appointment(b.professionalId, a.serviceId)],
      ["GET", `/api/time-blocks/${bData.timeBlockId}`],
      ["DELETE", `/api/time-blocks/${bData.timeBlockId}`],
      ["POST", "/api/time-blocks", { professionalId: b.professionalId, startsAt: at(day, "08:00"), endsAt: at(day, "09:00") }],
      ["GET", `/api/availability?serviceId=${b.serviceId}&date=${day}`],
      ["GET", `/api/availability?serviceId=${b.serviceId}&date=${day}&professionalId=${b.professionalId}`],
      ["GET", `/api/availability?serviceId=${a.serviceId}&date=${day}&professionalId=${b.professionalId}`],
    ];
  };

  // Rotas sem id do B: o A só lê e grava o próprio tenant.
  const collectionRoutes = (): [Method, string, unknown?][] => {
    const range = `from=${encodeURIComponent(at(dayPlus(40), "00:00"))}&to=${encodeURIComponent(at(dayPlus(41), "00:00"))}`;
    return [
      ["GET", "/api/settings"],
      ["PATCH", "/api/settings", { description: "Descrição do A" }],
      ["GET", `/api/appointments?${range}`],
      ["GET", `/api/appointments?${range}&professionalId=${b.professionalId}`],
      ["GET", `/api/time-blocks?${range}`],
      ["GET", `/api/time-blocks?${range}&professionalId=${b.professionalId}`],
    ];
  };

  const bSecrets = () => [
    b.tenantId,
    b.professionalId,
    b.otherProfessionalId,
    b.serviceId,
    bData.appointmentId,
    bData.canceledAppointmentId,
    bData.timeBlockId,
    "Estúdio B",
    "Cliente do B",
    "Bloqueio do B",
  ];

  it("a matriz cobre todo par método × rota da agenda", () => {
    const covered = new Set(
      [...byIdRoutes(), ...collectionRoutes()].map(
        ([method, path]) => `${method} ${matchRoute(new URL(path, "http://x").pathname).pattern}`,
      ),
    );
    const all = Object.entries(AGENDA_ROUTES).flatMap(([pattern, module]) =>
      HTTP_METHODS.filter((method) => module[method]).map((method) => `${method} ${pattern}`),
    );
    expect([...covered].sort()).toEqual(all.sort());
  });

  it("com sessão do A, toda rota com id do B responde 404 not_found e os dados do B não mudam", async () => {
    const before = await snapshotOfB();
    for (const [method, path, body] of byIdRoutes()) {
      const result = await call(method, path, { token: a.token, body });
      expect({ route: `${method} ${path}`, status: result.status, code: result.body?.error?.code }).toEqual({
        route: `${method} ${path}`,
        status: 404,
        code: "not_found",
      });
      for (const secret of bSecrets()) expect(JSON.stringify(result.body)).not.toContain(secret);
    }
    expect(await snapshotOfB()).toEqual(before);
    // Mesma resposta de um id que não existe.
    const ghost = await call("GET", `/api/appointments/${missing}`, { token: a.token });
    const real = await call("GET", `/api/appointments/${bData.appointmentId}`, { token: a.token });
    expect(real.body).toEqual(ghost.body);
  });

  it("listas e configurações do A só enxergam e gravam o tenant A", async () => {
    const before = await snapshotOfB();
    for (const [method, path, body] of collectionRoutes()) {
      const result = await call(method, path, { token: a.token, body });
      expect(result.status, `${method} ${path}`).toBe(200);
      for (const secret of bSecrets()) expect(JSON.stringify(result.body), `${method} ${path}`).not.toContain(secret);
    }
    expect(await snapshotOfB()).toEqual(before);
    const settingsA = await call("GET", "/api/settings", { token: a.token });
    expect(settingsA.body.settings.name).toBe("Estúdio A");
    await call("PATCH", "/api/settings", { token: a.token, body: { description: "" } });
  });

  it("o tenant B segue com acesso normal aos próprios dados", async () => {
    const read = await call("GET", `/api/appointments/${bData.appointmentId}`, { token: b.token });
    expect(read.status).toBe(200);
    expect(read.body.appointment.contact.name).toBe("Cliente do B");
    expect((await call("GET", `/api/time-blocks/${bData.timeBlockId}`, { token: b.token })).status).toBe(200);
  });

  it("cabeçalho de tenant forjado pelo cliente não troca o escopo", async () => {
    const forged = { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: missing };
    await expectError(call("GET", `/api/appointments/${bData.appointmentId}`, { token: a.token, headers: forged }), 404, "not_found");
    const settings = await call("GET", "/api/settings", { token: a.token, headers: forged });
    expect(settings.body.settings.name).toBe("Estúdio A");
  });

  it("sem sessão, com token inválido ou com só o cabeçalho forjado: 401 em todas as rotas, sem chegar ao handler", async () => {
    const before = await snapshotOfB();
    const variants: CallOptions[] = [
      {},
      { token: "token-que-nao-existe" },
      { headers: { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: missing } },
    ];
    for (const variant of variants) {
      for (const [method, path, body] of [...byIdRoutes(), ...collectionRoutes()]) {
        const result = await call(method, path, { ...variant, body });
        expect({ route: `${method} ${path}`, status: result.status, code: result.body?.error?.code, reached: result.reachedHandler }).toEqual({
          route: `${method} ${path}`,
          status: 401,
          code: "unauthorized",
          reached: false,
        });
      }
    }
    expect(await snapshotOfB()).toEqual(before);
  });

  it("handler chamado sem o contexto do proxy também responde 401 (defesa em profundidade)", async () => {
    for (const [pattern, module] of Object.entries(AGENDA_ROUTES)) {
      const path = pattern.replace("[id]", bData.appointmentId);
      const { params } = matchRoute(path);
      for (const method of HTTP_METHODS) {
        const handler = module[method];
        if (!handler) continue;
        const response = await handler(apiRequest(path, { method, body: method === "GET" ? undefined : {} }), {
          params: Promise.resolve(params),
        });
        expect(response.status, `${method} ${pattern}`).toBe(401);
      }
    }
  });
});
