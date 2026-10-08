import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import * as professionalsRoute from "@/app/api/professionals/route";
import * as professionalRoute from "@/app/api/professionals/[id]/route";
import * as professionalArchiveRoute from "@/app/api/professionals/[id]/archive/route";
import * as professionalUnarchiveRoute from "@/app/api/professionals/[id]/unarchive/route";
import * as professionalServicesRoute from "@/app/api/professionals/[id]/services/route";
import * as professionalServiceRoute from "@/app/api/professionals/[id]/services/[serviceId]/route";
import * as professionalWorkingHoursRoute from "@/app/api/professionals/[id]/working-hours/route";
import * as servicesRoute from "@/app/api/services/route";
import * as serviceRoute from "@/app/api/services/[id]/route";
import * as serviceArchiveRoute from "@/app/api/services/[id]/archive/route";
import * as serviceUnarchiveRoute from "@/app/api/services/[id]/unarchive/route";
import * as workingHoursRoute from "@/app/api/working-hours/[id]/route";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { apiRequest, cleanupAuthData, sessionCookieOf, throughProxy, uniqueEmail } from "./helpers/auth";

// Fase 4: API de profissionais, serviços, vínculos N:N e horários (guia 5, 6, 7c, 7d; D4-D7).
// As requisições passam pelo proxy de verdade (sessão no banco, tenantId injetado) antes do handler.

const PASSWORD = "senha-forte-123";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof HTTP_METHODS)[number];
type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Partial<Record<Method, RouteHandler>>;

// Tabela de rotas igual à árvore de src/app/api (o teste de cobertura abaixo confere).
const ROUTES: Record<string, RouteModule> = {
  "/api/professionals": professionalsRoute,
  "/api/professionals/[id]": professionalRoute,
  "/api/professionals/[id]/archive": professionalArchiveRoute,
  "/api/professionals/[id]/unarchive": professionalUnarchiveRoute,
  "/api/professionals/[id]/services": professionalServicesRoute,
  "/api/professionals/[id]/services/[serviceId]": professionalServiceRoute,
  "/api/professionals/[id]/working-hours": professionalWorkingHoursRoute,
  "/api/services": servicesRoute,
  "/api/services/[id]": serviceRoute,
  "/api/services/[id]/archive": serviceArchiveRoute,
  "/api/services/[id]/unarchive": serviceUnarchiveRoute,
  "/api/working-hours/[id]": workingHoursRoute,
} as unknown as Record<string, RouteModule>;

function matchRoute(pathname: string): { pattern: string; params: Record<string, string> } {
  for (const pattern of Object.keys(ROUTES)) {
    const names: string[] = [];
    const regex = new RegExp(
      `^${pattern.replace(/\[(\w+)\]/g, (_, name: string) => (names.push(name), "([^/]+)"))}$`,
    );
    const match = regex.exec(pathname);
    if (match) return { pattern, params: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) };
  }
  throw new Error(`Rota não mapeada no teste: ${pathname}`);
}

interface CallOptions {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

// Simula o Next: proxy primeiro; se ele deixa passar, chama o handler do método com os params.
async function call(method: Method, path: string, options: CallOptions = {}) {
  const { pattern, params } = matchRoute(new URL(path, "http://localhost").pathname);
  const handler = ROUTES[pattern][method];
  if (!handler) throw new Error(`${method} ${pattern} não existe`);
  const { proxyResponse, forwarded } = await throughProxy(
    apiRequest(path, {
      method,
      body: options.body,
      rawBody: options.rawBody,
      cookie: options.token,
      headers: options.headers,
    }),
  );
  const response = forwarded ? await handler(forwarded, { params: Promise.resolve(params) }) : proxyResponse;
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, reachedHandler: forwarded !== null };
}

async function expectError(
  promise: ReturnType<typeof call>,
  status: number,
  code: string,
): Promise<{ code: string; message: string }> {
  const { status: actual, body } = await promise;
  expect({ status: actual, code: body?.error?.code }).toEqual({ status, code });
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
  return body.error;
}

interface Account {
  token: string;
  tenantId: string;
}

async function registerAccount(businessName: string): Promise<Account> {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName, email: uniqueEmail("catalogo"), password: PASSWORD },
    }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  return { token: sessionCookieOf(response)!.value, tenantId: body.tenant.id };
}

async function createProfessional(account: Account, name = "Ana Souza") {
  const { status, body } = await call("POST", "/api/professionals", { token: account.token, body: { name } });
  expect(status).toBe(201);
  return body.professional as { id: string; name: string; archivedAt: string | null };
}

async function createService(account: Account, input: Record<string, unknown> = {}) {
  const { status, body } = await call("POST", "/api/services", {
    token: account.token,
    body: { name: "Corte", durationMinutes: 30, priceCents: 5000, ...input },
  });
  expect(status).toBe(201);
  return body.service as { id: string; name: string; durationMinutes: number; priceCents: number };
}

let a: Account;
let b: Account;

beforeAll(async () => {
  [a, b] = await Promise.all([registerAccount("Estúdio A"), registerAccount("Estúdio B")]);
});

afterAll(async () => {
  await cleanupAuthData();
  await prisma.$disconnect();
});

describe("cobertura: toda rota de negócio está na tabela do teste", () => {
  it("a árvore src/app/api (fora /api/auth) bate com ROUTES", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[])
      .filter((file) => file.split(sep).at(-1) === "route.ts")
      .map((file) => ["/api", ...file.split(sep).slice(0, -1)].join("/"))
      .filter((route) => !route.startsWith("/api/auth"))
      .sort();
    expect(routes).toEqual(Object.keys(ROUTES).sort());
  });

  it("profissionais e serviços não têm DELETE: só arquivam (D6)", () => {
    expect(professionalRoute).not.toHaveProperty("DELETE");
    expect(serviceRoute).not.toHaveProperty("DELETE");
  });
});

describe("profissionais (guia 7c)", () => {
  it("CRUD: cria, lista, lê, edita, arquiva e desarquiva", async () => {
    const created = await createProfessional(a, "  Bruna Lima  ");
    expect(created).toMatchObject({ name: "Bruna Lima", archivedAt: null });
    expect(created).not.toHaveProperty("tenantId");

    const list = await call("GET", "/api/professionals", { token: a.token });
    expect(list.status).toBe(200);
    expect(list.body.professionals.map((p: { id: string }) => p.id)).toContain(created.id);

    const read = await call("GET", `/api/professionals/${created.id}`, { token: a.token });
    expect(read).toMatchObject({ status: 200, body: { professional: { id: created.id, name: "Bruna Lima" } } });

    const edited = await call("PATCH", `/api/professionals/${created.id}`, {
      token: a.token,
      body: { name: "Bruna L. Lima" },
    });
    expect(edited).toMatchObject({ status: 200, body: { professional: { name: "Bruna L. Lima" } } });

    const archived = await call("POST", `/api/professionals/${created.id}/archive`, { token: a.token });
    expect(archived.status).toBe(200);
    expect(archived.body.professional.archivedAt).toEqual(expect.any(String));

    const active = await call("GET", "/api/professionals", { token: a.token });
    expect(active.body.professionals.map((p: { id: string }) => p.id)).not.toContain(created.id);
    const all = await call("GET", "/api/professionals?includeArchived=true", { token: a.token });
    expect(all.body.professionals.map((p: { id: string }) => p.id)).toContain(created.id);
    // Arquivado continua no banco e legível por id.
    const stillThere = await call("GET", `/api/professionals/${created.id}`, { token: a.token });
    expect(stillThere.body.professional.archivedAt).not.toBeNull();

    const unarchived = await call("POST", `/api/professionals/${created.id}/unarchive`, { token: a.token });
    expect(unarchived).toMatchObject({ status: 200, body: { professional: { archivedAt: null } } });
  });

  it("lista ordenada por nome", async () => {
    const account = await registerAccount("Estúdio Ordem");
    for (const name of ["Carla", "Alice", "Bia"]) await createProfessional(account, name);
    const { body } = await call("GET", "/api/professionals", { token: account.token });
    expect(body.professionals.map((p: { name: string }) => p.name)).toEqual(["Alice", "Bia", "Carla"]);
  });

  it("entradas inválidas: 400 invalid_input e nada é gravado", async () => {
    const before = await prisma.professional.count({ where: { tenantId: a.tenantId } });
    for (const body of [{}, { name: "" }, { name: " a " }, { name: "x".repeat(81) }, { name: 42 }, []]) {
      await expectError(call("POST", "/api/professionals", { token: a.token, body }), 400, "invalid_input");
    }
    await expectError(call("POST", "/api/professionals", { token: a.token, rawBody: "{nome" }), 400, "invalid_input");
    expect(await prisma.professional.count({ where: { tenantId: a.tenantId } })).toBe(before);

    const professional = await createProfessional(a);
    await expectError(call("PATCH", `/api/professionals/${professional.id}`, { token: a.token, body: {} }), 400, "invalid_input");
    await expectError(
      call("PATCH", `/api/professionals/${professional.id}`, { token: a.token, body: { name: "z" } }),
      400,
      "invalid_input",
    );
    await expectError(call("GET", "/api/professionals?includeArchived=talvez", { token: a.token }), 400, "invalid_input");
  });

  it("id inexistente ou malformado: 404 not_found", async () => {
    for (const id of ["0190a1b2-0000-7000-8000-000000000000", "nao-e-uuid"]) {
      await expectError(call("GET", `/api/professionals/${id}`, { token: a.token }), 404, "not_found");
      await expectError(call("PATCH", `/api/professionals/${id}`, { token: a.token, body: { name: "Novo" } }), 404, "not_found");
      await expectError(call("POST", `/api/professionals/${id}/archive`, { token: a.token }), 404, "not_found");
      await expectError(call("POST", `/api/professionals/${id}/unarchive`, { token: a.token }), 404, "not_found");
    }
  });
});

describe("serviços (guia 7c, D5)", () => {
  it("CRUD: cria, lista, lê, edita parcialmente, arquiva e desarquiva", async () => {
    const created = await createService(a, { name: "  Escova  ", durationMinutes: 45, priceCents: 7990 });
    expect(created).toMatchObject({ name: "Escova", durationMinutes: 45, priceCents: 7990 });
    expect(created).not.toHaveProperty("tenantId");

    const list = await call("GET", "/api/services", { token: a.token });
    expect(list.body.services.map((s: { id: string }) => s.id)).toContain(created.id);
    const read = await call("GET", `/api/services/${created.id}`, { token: a.token });
    expect(read).toMatchObject({ status: 200, body: { service: { priceCents: 7990 } } });

    const edited = await call("PATCH", `/api/services/${created.id}`, { token: a.token, body: { priceCents: 8500 } });
    expect(edited).toMatchObject({
      status: 200,
      body: { service: { name: "Escova", durationMinutes: 45, priceCents: 8500 } },
    });

    const archived = await call("POST", `/api/services/${created.id}/archive`, { token: a.token });
    expect(archived.body.service.archivedAt).toEqual(expect.any(String));
    const active = await call("GET", "/api/services", { token: a.token });
    expect(active.body.services.map((s: { id: string }) => s.id)).not.toContain(created.id);
    const all = await call("GET", "/api/services?includeArchived=true", { token: a.token });
    expect(all.body.services.map((s: { id: string }) => s.id)).toContain(created.id);

    const unarchived = await call("POST", `/api/services/${created.id}/unarchive`, { token: a.token });
    expect(unarchived).toMatchObject({ status: 200, body: { service: { archivedAt: null } } });
  });

  it("limites válidos: duração 5 e 480, preço 0 (grátis)", async () => {
    await createService(a, { durationMinutes: 5, priceCents: 0 });
    await createService(a, { durationMinutes: 480, priceCents: 1 });
  });

  it.each([
    ["duração não múltipla de 5", { durationMinutes: 7 }],
    ["duração zero", { durationMinutes: 0 }],
    ["duração acima de 480", { durationMinutes: 485 }],
    ["duração fracionária", { durationMinutes: 30.5 }],
    ["duração como texto", { durationMinutes: "30" }],
    ["preço negativo", { priceCents: -1 }],
    ["preço em float", { priceCents: 49.9 }],
    ["preço como texto", { priceCents: "5000" }],
    ["preço gigante", { priceCents: 2 ** 31 }],
    ["sem nome", { name: undefined }],
  ])("%s: 400 invalid_input", async (_label, override) => {
    const body = { name: "Corte", durationMinutes: 30, priceCents: 5000, ...override };
    await expectError(call("POST", "/api/services", { token: a.token, body }), 400, "invalid_input");
  });

  it("edição inválida não altera o serviço", async () => {
    const service = await createService(a);
    for (const body of [{}, { durationMinutes: 12 }, { priceCents: -5 }]) {
      await expectError(call("PATCH", `/api/services/${service.id}`, { token: a.token, body }), 400, "invalid_input");
    }
    const { body } = await call("GET", `/api/services/${service.id}`, { token: a.token });
    expect(body.service).toMatchObject({ durationMinutes: 30, priceCents: 5000 });
  });

  it("id inexistente ou malformado: 404 not_found", async () => {
    for (const id of ["0190a1b2-0000-7000-8000-000000000000", "123"]) {
      await expectError(call("GET", `/api/services/${id}`, { token: a.token }), 404, "not_found");
      await expectError(call("PATCH", `/api/services/${id}`, { token: a.token, body: { priceCents: 1 } }), 404, "not_found");
      await expectError(call("POST", `/api/services/${id}/archive`, { token: a.token }), 404, "not_found");
      await expectError(call("POST", `/api/services/${id}/unarchive`, { token: a.token }), 404, "not_found");
    }
  });
});

describe("vínculo profissional × serviço (N:N, D5)", () => {
  it("vincula (idempotente), lista, desvincula", async () => {
    const professional = await createProfessional(a);
    const [corte, barba] = [await createService(a, { name: "Corte" }), await createService(a, { name: "Barba" })];
    const base = `/api/professionals/${professional.id}/services`;

    expect((await call("PUT", `${base}/${corte.id}`, { token: a.token })).status).toBe(204);
    expect((await call("PUT", `${base}/${corte.id}`, { token: a.token })).status).toBe(204);
    expect((await call("PUT", `${base}/${barba.id}`, { token: a.token })).status).toBe(204);

    const list = await call("GET", base, { token: a.token });
    expect(list.body.services.map((s: { name: string }) => s.name)).toEqual(["Barba", "Corte"]);

    expect((await call("DELETE", `${base}/${barba.id}`, { token: a.token })).status).toBe(204);
    await expectError(call("DELETE", `${base}/${barba.id}`, { token: a.token }), 404, "not_found");
    const after = await call("GET", base, { token: a.token });
    expect(after.body.services.map((s: { id: string }) => s.id)).toEqual([corte.id]);
  });

  it("um serviço atende vários profissionais", async () => {
    const service = await createService(a, { name: "Manicure" });
    const [p1, p2] = [await createProfessional(a, "P1"), await createProfessional(a, "P2")];
    for (const p of [p1, p2]) {
      expect((await call("PUT", `/api/professionals/${p.id}/services/${service.id}`, { token: a.token })).status).toBe(204);
    }
    expect(await prisma.professionalService.count({ where: { serviceId: service.id } })).toBe(2);
  });

  it("PUT da lista substitui todos os vínculos; lista vazia limpa", async () => {
    const professional = await createProfessional(a);
    const [s1, s2, s3] = [await createService(a, { name: "S1" }), await createService(a, { name: "S2" }), await createService(a, { name: "S3" })];
    const path = `/api/professionals/${professional.id}/services`;

    const first = await call("PUT", path, { token: a.token, body: { serviceIds: [s1.id, s2.id, s1.id] } });
    expect(first.status).toBe(200);
    expect(first.body.services.map((s: { name: string }) => s.name)).toEqual(["S1", "S2"]);

    const second = await call("PUT", path, { token: a.token, body: { serviceIds: [s3.id] } });
    expect(second.body.services.map((s: { name: string }) => s.name)).toEqual(["S3"]);

    const cleared = await call("PUT", path, { token: a.token, body: { serviceIds: [] } });
    expect(cleared).toMatchObject({ status: 200, body: { services: [] } });
  });

  it("entradas inválidas: corpo errado é 400; id de serviço inexistente é 404 e nada muda", async () => {
    const professional = await createProfessional(a);
    const service = await createService(a);
    const path = `/api/professionals/${professional.id}/services`;
    await call("PUT", path, { token: a.token, body: { serviceIds: [service.id] } });

    for (const body of [{}, { serviceIds: "x" }, { serviceIds: [1] }]) {
      await expectError(call("PUT", path, { token: a.token, body }), 400, "invalid_input");
    }
    for (const serviceIds of [[service.id, "0190a1b2-0000-7000-8000-000000000000"], ["nao-uuid"]]) {
      await expectError(call("PUT", path, { token: a.token, body: { serviceIds } }), 404, "not_found");
    }
    await expectError(call("PUT", `${path}/0190a1b2-0000-7000-8000-000000000000`, { token: a.token }), 404, "not_found");
    const { body } = await call("GET", path, { token: a.token });
    expect(body.services.map((s: { id: string }) => s.id)).toEqual([service.id]);
  });
});

describe("horários de trabalho (D5, D6)", () => {
  it("CRUD: cria vários intervalos no dia, lista ordenado, edita e apaga de verdade", async () => {
    const professional = await createProfessional(a);
    const path = `/api/professionals/${professional.id}/working-hours`;

    const afternoon = await call("POST", path, { token: a.token, body: { weekday: 1, start: "13:00", end: "18:00" } });
    expect(afternoon.status).toBe(201);
    expect(afternoon.body.workingHours).toMatchObject({ professionalId: professional.id, weekday: 1, start: "13:00", end: "18:00" });
    expect(afternoon.body.workingHours).not.toHaveProperty("tenantId");

    // Encostar (12:00 até 13:00) não é sobreposição; 24:00 vale como fim.
    const morning = await call("POST", path, { token: a.token, body: { weekday: 1, start: "08:00", end: "13:00" } });
    expect(morning.status).toBe(201);
    const night = await call("POST", path, { token: a.token, body: { weekday: 5, start: "20:00", end: "24:00" } });
    expect(night.body.workingHours.end).toBe("24:00");

    const list = await call("GET", path, { token: a.token });
    expect(list.body.workingHours.map((w: { weekday: number; start: string }) => `${w.weekday} ${w.start}`)).toEqual([
      "1 08:00",
      "1 13:00",
      "5 20:00",
    ]);

    const edited = await call("PATCH", `/api/working-hours/${night.body.workingHours.id}`, {
      token: a.token,
      body: { weekday: 6, start: "09:00", end: "12:30" },
    });
    expect(edited).toMatchObject({ status: 200, body: { workingHours: { weekday: 6, start: "09:00", end: "12:30" } } });

    const removed = await call("DELETE", `/api/working-hours/${morning.body.workingHours.id}`, { token: a.token });
    expect(removed.status).toBe(204);
    expect(await prisma.workingHours.count({ where: { id: morning.body.workingHours.id } })).toBe(0);
    await expectError(call("DELETE", `/api/working-hours/${morning.body.workingHours.id}`, { token: a.token }), 404, "not_found");
  });

  it("sobreposição com intervalo gravado: 409 working_hours_overlap (criar e editar)", async () => {
    const professional = await createProfessional(a);
    const path = `/api/professionals/${professional.id}/working-hours`;
    await call("POST", path, { token: a.token, body: { weekday: 2, start: "09:00", end: "12:00" } });
    const other = await call("POST", path, { token: a.token, body: { weekday: 2, start: "14:00", end: "18:00" } });

    await expectError(call("POST", path, { token: a.token, body: { weekday: 2, start: "11:00", end: "15:00" } }), 409, "working_hours_overlap");
    await expectError(
      call("PATCH", `/api/working-hours/${other.body.workingHours.id}`, { token: a.token, body: { weekday: 2, start: "10:00", end: "15:00" } }),
      409,
      "working_hours_overlap",
    );
    // Mesmo horário em outro dia é permitido.
    expect((await call("POST", path, { token: a.token, body: { weekday: 3, start: "11:00", end: "15:00" } })).status).toBe(201);
    expect(await prisma.workingHours.count({ where: { professionalId: professional.id } })).toBe(3);
  });

  it.each([
    ["fim antes do início", { weekday: 1, start: "18:00", end: "09:00" }],
    ["fim igual ao início", { weekday: 1, start: "09:00", end: "09:00" }],
    ["início 24:00", { weekday: 1, start: "24:00", end: "24:00" }],
    ["formato sem zero", { weekday: 1, start: "9:00", end: "12:00" }],
    ["hora inválida", { weekday: 1, start: "09:00", end: "25:00" }],
    ["dia 7", { weekday: 7, start: "09:00", end: "12:00" }],
    ["dia negativo", { weekday: -1, start: "09:00", end: "12:00" }],
    ["dia fracionário", { weekday: 1.5, start: "09:00", end: "12:00" }],
    ["sem fim", { weekday: 1, start: "09:00" }],
    ["horário como número", { weekday: 1, start: 540, end: 720 }],
  ])("%s: 400 invalid_input (criar e editar)", async (_label, body) => {
    const professional = await createProfessional(a);
    const path = `/api/professionals/${professional.id}/working-hours`;
    const valid = await call("POST", path, { token: a.token, body: { weekday: 4, start: "08:00", end: "09:00" } });
    await expectError(call("POST", path, { token: a.token, body }), 400, "invalid_input");
    await expectError(call("PATCH", `/api/working-hours/${valid.body.workingHours.id}`, { token: a.token, body }), 400, "invalid_input");
    expect(await prisma.workingHours.count({ where: { professionalId: professional.id } })).toBe(1);
  });

  it("PUT substitui a grade inteira; grade com sobreposição é recusada e nada muda", async () => {
    const professional = await createProfessional(a);
    const path = `/api/professionals/${professional.id}/working-hours`;
    await call("POST", path, { token: a.token, body: { weekday: 0, start: "10:00", end: "14:00" } });

    const replaced = await call("PUT", path, {
      token: a.token,
      body: {
        intervals: [
          { weekday: 1, start: "14:00", end: "18:00" },
          { weekday: 1, start: "08:00", end: "12:00" },
          { weekday: 3, start: "08:00", end: "18:00" },
        ],
      },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.workingHours.map((w: { weekday: number; start: string }) => `${w.weekday} ${w.start}`)).toEqual([
      "1 08:00",
      "1 14:00",
      "3 08:00",
    ]);

    await expectError(
      call("PUT", path, {
        token: a.token,
        body: { intervals: [{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }] },
      }),
      400,
      "invalid_input",
    );
    await expectError(call("PUT", path, { token: a.token, body: { intervals: "seg 8-12" } }), 400, "invalid_input");
    expect(await prisma.workingHours.count({ where: { professionalId: professional.id } })).toBe(3);

    const cleared = await call("PUT", path, { token: a.token, body: { intervals: [] } });
    expect(cleared).toMatchObject({ status: 200, body: { workingHours: [] } });
  });

  it("profissional ou horário inexistente: 404 not_found", async () => {
    const missing = "0190a1b2-0000-7000-8000-000000000000";
    const body = { weekday: 1, start: "08:00", end: "09:00" };
    await expectError(call("GET", `/api/professionals/${missing}/working-hours`, { token: a.token }), 404, "not_found");
    await expectError(call("POST", `/api/professionals/${missing}/working-hours`, { token: a.token, body }), 404, "not_found");
    await expectError(call("PUT", `/api/professionals/${missing}/working-hours`, { token: a.token, body: { intervals: [body] } }), 404, "not_found");
    await expectError(call("PATCH", `/api/working-hours/${missing}`, { token: a.token, body }), 404, "not_found");
    await expectError(call("DELETE", `/api/working-hours/x`, { token: a.token }), 404, "not_found");
  });
});

describe("isolamento: tenant A é negado em todas as rotas do B (guia 7d, 9)", () => {
  interface Fixture {
    professionalId: string;
    serviceId: string;
    linkedServiceId: string;
    workingHoursId: string;
  }

  let bData: Fixture;
  let aProfessionalId: string;
  let aServiceId: string;

  const snapshotOfB = async () => ({
    professionals: await prisma.professional.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
    services: await prisma.service.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
    links: await prisma.professionalService.findMany({ where: { tenantId: b.tenantId }, orderBy: { serviceId: "asc" } }),
    workingHours: await prisma.workingHours.findMany({ where: { tenantId: b.tenantId }, orderBy: { id: "asc" } }),
  });

  beforeAll(async () => {
    const professional = await createProfessional(b, "Profissional do B");
    const service = await createService(b, { name: "Serviço do B" });
    const linked = await createService(b, { name: "Vinculado do B" });
    await call("PUT", `/api/professionals/${professional.id}/services/${linked.id}`, { token: b.token });
    const wh = await call("POST", `/api/professionals/${professional.id}/working-hours`, {
      token: b.token,
      body: { weekday: 1, start: "09:00", end: "12:00" },
    });
    bData = { professionalId: professional.id, serviceId: service.id, linkedServiceId: linked.id, workingHoursId: wh.body.workingHours.id };
    aProfessionalId = (await createProfessional(a, "Profissional do A")).id;
    aServiceId = (await createService(a, { name: "Serviço do A" })).id;
  });

  // Toda rota com id, apontando para dados do B. A tabela de cobertura garante que nenhuma ficou de fora.
  const byIdRoutes = (): [Method, string, unknown?][] => {
    const wh = { weekday: 3, start: "08:00", end: "09:00" };
    return [
      ["GET", `/api/professionals/${bData.professionalId}`],
      ["PATCH", `/api/professionals/${bData.professionalId}`, { name: "Invadido" }],
      ["POST", `/api/professionals/${bData.professionalId}/archive`],
      ["POST", `/api/professionals/${bData.professionalId}/unarchive`],
      ["GET", `/api/professionals/${bData.professionalId}/services`],
      ["PUT", `/api/professionals/${bData.professionalId}/services`, { serviceIds: [] }],
      ["PUT", `/api/professionals/${bData.professionalId}/services/${bData.serviceId}`],
      ["DELETE", `/api/professionals/${bData.professionalId}/services/${bData.linkedServiceId}`],
      ["GET", `/api/professionals/${bData.professionalId}/working-hours`],
      ["POST", `/api/professionals/${bData.professionalId}/working-hours`, wh],
      ["PUT", `/api/professionals/${bData.professionalId}/working-hours`, { intervals: [] }],
      ["GET", `/api/services/${bData.serviceId}`],
      ["PATCH", `/api/services/${bData.serviceId}`, { priceCents: 1 }],
      ["POST", `/api/services/${bData.serviceId}/archive`],
      ["POST", `/api/services/${bData.serviceId}/unarchive`],
      ["PATCH", `/api/working-hours/${bData.workingHoursId}`, wh],
      ["DELETE", `/api/working-hours/${bData.workingHoursId}`],
      // Misturando: profissional do A com serviço do B, e vice-versa.
      ["PUT", `/api/professionals/${aProfessionalId}/services/${bData.serviceId}`],
      ["PUT", `/api/professionals/${bData.professionalId}/services/${aServiceId}`],
      ["DELETE", `/api/professionals/${aProfessionalId}/services/${bData.linkedServiceId}`],
      ["PUT", `/api/professionals/${aProfessionalId}/services`, { serviceIds: [bData.serviceId] }],
    ];
  };

  const collectionRoutes: [Method, string, unknown?][] = [
    ["GET", "/api/professionals"],
    ["GET", "/api/professionals?includeArchived=true"],
    ["POST", "/api/professionals", { name: "Sem sessão" }],
    ["GET", "/api/services"],
    ["GET", "/api/services?includeArchived=true"],
    ["POST", "/api/services", { name: "Sem sessão", durationMinutes: 30, priceCents: 100 }],
  ];

  it("a matriz cobre todo par método × rota da API de negócio", () => {
    const covered = new Set(
      [...byIdRoutes(), ...collectionRoutes].map(([method, path]) => `${method} ${matchRoute(new URL(path, "http://x").pathname).pattern}`),
    );
    const all = Object.entries(ROUTES).flatMap(([pattern, module]) =>
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
      // Mesma resposta de um id que não existe: nada revela que o registro do B existe.
      expect(JSON.stringify(result.body)).not.toContain("do B");
    }
    expect(await snapshotOfB()).toEqual(before);
    expect(await prisma.professionalService.count({ where: { professionalId: aProfessionalId } })).toBe(0);
  });

  it("listas e criação do A só enxergam e gravam no tenant A", async () => {
    const before = await snapshotOfB();
    const bIds = [bData.professionalId, bData.serviceId, bData.linkedServiceId];
    for (const [method, path, body] of collectionRoutes) {
      const result = await call(method, path, { token: a.token, body });
      expect(result.status, `${method} ${path}`).toBe(method === "POST" ? 201 : 200);
      for (const id of bIds) expect(JSON.stringify(result.body)).not.toContain(id);
      if (method === "POST") {
        const id = (result.body.professional ?? result.body.service).id;
        const owner = path.includes("professionals")
          ? await prisma.professional.findUnique({ where: { id }, select: { tenantId: true } })
          : await prisma.service.findUnique({ where: { id }, select: { tenantId: true } });
        expect(owner?.tenantId).toBe(a.tenantId);
      }
    }
    expect(await snapshotOfB()).toEqual(before);
  });

  it("o tenant B segue com acesso normal aos próprios dados", async () => {
    const { status, body } = await call("GET", `/api/professionals/${bData.professionalId}/services`, { token: b.token });
    expect(status).toBe(200);
    expect(body.services.map((s: { id: string }) => s.id)).toEqual([bData.linkedServiceId]);
  });

  it("cabeçalho de tenant forjado pelo cliente não troca o escopo", async () => {
    const forged = { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: "0190a1b2-0000-7000-8000-000000000000" };
    await expectError(call("GET", `/api/professionals/${bData.professionalId}`, { token: a.token, headers: forged }), 404, "not_found");
    const list = await call("GET", "/api/professionals", { token: a.token, headers: forged });
    expect(JSON.stringify(list.body)).not.toContain(bData.professionalId);
  });

  it("sem sessão, com token inválido ou com só o cabeçalho forjado: 401 em todas as rotas, sem chegar ao handler", async () => {
    const before = await snapshotOfB();
    const variants: CallOptions[] = [
      {},
      { token: "token-que-nao-existe" },
      { headers: { [TENANT_ID_HEADER]: b.tenantId, [USER_ID_HEADER]: "0190a1b2-0000-7000-8000-000000000000" } },
    ];
    for (const variant of variants) {
      for (const [method, path, body] of [...byIdRoutes(), ...collectionRoutes]) {
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
    for (const [pattern, module] of Object.entries(ROUTES)) {
      const path = pattern.replace("[id]", bData.professionalId).replace("[serviceId]", bData.serviceId);
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
