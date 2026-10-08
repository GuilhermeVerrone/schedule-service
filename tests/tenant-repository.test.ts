import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Professional, Service, Tenant, WorkingHours } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  createTenantRepository,
  TenantScopeError,
  WorkingHoursOverlapError,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

let tenantA: Tenant;
let tenantB: Tenant;
let repoA: TenantRepository;
let repoB: TenantRepository;

// Dados do tenant B que o tenant A tenta alcançar.
let profB: Professional;
let serviceB: Service;
let hoursB: WorkingHours;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTestTenant("a"), createTestTenant("b")]);
  repoA = createTenantRepository(tenantA.id);
  repoB = createTenantRepository(tenantB.id);

  profB = await repoB.professionals.create({ name: "Bia (B)" });
  serviceB = await repoB.services.create({ name: "Corte (B)", durationMinutes: 30, priceCents: 5000 });
  await repoB.professionalServices.link(profB.id, serviceB.id);
  const created = await repoB.workingHours.create(profB.id, { weekday: 1, start: "09:00", end: "12:00" });
  hoursB = created!;
});

afterAll(async () => {
  await deleteTestTenants(tenantA, tenantB);
  await prisma.$disconnect();
});

async function expectTenantBUntouched(): Promise<void> {
  const [prof, service, links, hours] = await Promise.all([
    prisma.professional.findUniqueOrThrow({ where: { id: profB.id } }),
    prisma.service.findUniqueOrThrow({ where: { id: serviceB.id } }),
    prisma.professionalService.findMany({ where: { professionalId: profB.id } }),
    prisma.workingHours.findMany({ where: { professionalId: profB.id } }),
  ]);
  expect(prof).toMatchObject({ tenantId: tenantB.id, name: "Bia (B)", archivedAt: null });
  expect(service).toMatchObject({
    tenantId: tenantB.id,
    name: "Corte (B)",
    durationMinutes: 30,
    priceCents: 5000,
    archivedAt: null,
  });
  expect(links.map((l) => l.serviceId)).toEqual([serviceB.id]);
  expect(hours).toHaveLength(1);
  expect(hours[0]).toMatchObject({ id: hoursB.id, weekday: 1, startMinute: 540, endMinute: 720 });
}

describe("construção do repositório", () => {
  it("exige tenantId", () => {
    // @ts-expect-error: chamada sem tenantId não compila e falha em runtime
    expect(() => createTenantRepository()).toThrow(TenantScopeError);
    expect(() => createTenantRepository("")).toThrow(TenantScopeError);
    expect(() => createTenantRepository("tenant-a")).toThrow(TenantScopeError);
  });

  it("expõe só o próprio tenant", async () => {
    expect((await repoA.tenant.get())?.id).toBe(tenantA.id);
  });
});

describe("isolamento: tenant A não lê dados do B", () => {
  it("listagens trazem só os dados do próprio tenant", async () => {
    const profA = await repoA.professionals.create({ name: "Ana (A)" });
    const serviceA = await repoA.services.create({ name: "Barba (A)", durationMinutes: 20, priceCents: 3000 });

    const [profs, services] = await Promise.all([
      repoA.professionals.list({ includeArchived: true }),
      repoA.services.list({ includeArchived: true }),
    ]);
    expect(profs.map((p) => p.id)).toEqual([profA.id]);
    expect(services.map((s) => s.id)).toEqual([serviceA.id]);
    expect(profs.every((p) => p.tenantId === tenantA.id)).toBe(true);
  });

  it("busca por ID de outro tenant retorna null", async () => {
    expect(await repoA.professionals.findById(profB.id)).toBeNull();
    expect(await repoA.services.findById(serviceB.id)).toBeNull();
    expect(await repoA.professionalServices.listServices(profB.id)).toBeNull();
    expect(await repoA.workingHours.list(profB.id)).toBeNull();
    // Controle: o dono enxerga.
    expect((await repoB.professionals.findById(profB.id))?.id).toBe(profB.id);
  });

  it("ID malformado se comporta como inexistente", async () => {
    expect(await repoA.professionals.findById("nao-e-uuid")).toBeNull();
    expect(await repoA.services.update("1 or 1=1", { name: "x" })).toBeNull();
    expect(await repoA.workingHours.delete("")).toBe(false);
  });
});

describe("isolamento: tenant A não altera dados do B", () => {
  it("editar, arquivar e desarquivar por ID do B retorna null e não muda nada", async () => {
    expect(await repoA.professionals.update(profB.id, { name: "Invadido" })).toBeNull();
    expect(await repoA.professionals.archive(profB.id)).toBeNull();
    expect(await repoA.professionals.unarchive(profB.id)).toBeNull();
    expect(await repoA.services.update(serviceB.id, { priceCents: 1 })).toBeNull();
    expect(await repoA.services.archive(serviceB.id)).toBeNull();
    expect(await repoA.services.unarchive(serviceB.id)).toBeNull();
    await expectTenantBUntouched();
  });

  it("não vincula nem desvincula serviços do B", async () => {
    const profA = await repoA.professionals.create({ name: "Caio (A)" });
    const serviceA = await repoA.services.create({ name: "Escova (A)", durationMinutes: 45, priceCents: 0 });

    expect(await repoA.professionalServices.link(profA.id, serviceB.id)).toBe(false);
    expect(await repoA.professionalServices.link(profB.id, serviceA.id)).toBe(false);
    expect(await repoA.professionalServices.link(profB.id, serviceB.id)).toBe(false);
    expect(await repoA.professionalServices.unlink(profB.id, serviceB.id)).toBe(false);
    expect(await repoA.professionalServices.setServices(profA.id, [serviceA.id, serviceB.id])).toBe(false);
    expect(await repoA.professionalServices.setServices(profB.id, [])).toBe(false);

    expect(await repoA.professionalServices.listServices(profA.id)).toEqual([]);
    await expectTenantBUntouched();
  });

  it("não lê, cria, edita, apaga nem substitui horários do B", async () => {
    const input = { weekday: 2, start: "08:00", end: "10:00" };
    expect(await repoA.workingHours.create(profB.id, input)).toBeNull();
    expect(await repoA.workingHours.update(hoursB.id, input)).toBeNull();
    expect(await repoA.workingHours.delete(hoursB.id)).toBe(false);
    expect(await repoA.workingHours.replaceAll(profB.id, [input])).toBeNull();
    await expectTenantBUntouched();
  });

  it("create ignora tenantId injetado na entrada", async () => {
    const injected = { name: "Infiltrado", tenantId: tenantB.id } as { name: string };
    const prof = await repoA.professionals.create(injected);
    expect(prof.tenantId).toBe(tenantA.id);
    expect(await repoB.professionals.findById(prof.id)).toBeNull();
  });
});

describe("banco recusa vínculos entre tenants (FK composta)", () => {
  it("professional_services com serviço de outro tenant falha", async () => {
    const profA = await repoA.professionals.create({ name: "Duda (A)" });
    await expect(
      prisma.professionalService.create({
        data: { tenantId: tenantA.id, professionalId: profA.id, serviceId: serviceB.id },
      }),
    ).rejects.toThrow();
  });

  it("working_hours com profissional de outro tenant falha", async () => {
    await expect(
      prisma.workingHours.create({
        data: { tenantId: tenantA.id, professionalId: profB.id, weekday: 3, startMinute: 0, endMinute: 60 },
      }),
    ).rejects.toThrow();
  });
});

describe("regras de profissionais, serviços e horários (D5, D6)", () => {
  it("arquivar esconde da listagem padrão e desarquivar traz de volta", async () => {
    const prof = await repoA.professionals.create({ name: "Eva (A)" });
    await repoA.professionals.archive(prof.id);
    expect((await repoA.professionals.list()).some((p) => p.id === prof.id)).toBe(false);
    expect((await repoA.professionals.list({ includeArchived: true })).some((p) => p.id === prof.id)).toBe(true);
    await repoA.professionals.unarchive(prof.id);
    expect((await repoA.professionals.list()).some((p) => p.id === prof.id)).toBe(true);
  });

  it("vínculo N:N: link idempotente, setServices substitui, unlink remove", async () => {
    const prof = await repoA.professionals.create({ name: "Fábio (A)" });
    const s1 = await repoA.services.create({ name: "S1", durationMinutes: 5, priceCents: 100 });
    const s2 = await repoA.services.create({ name: "S2", durationMinutes: 480, priceCents: 200 });

    expect(await repoA.professionalServices.link(prof.id, s1.id)).toBe(true);
    expect(await repoA.professionalServices.link(prof.id, s1.id)).toBe(true);
    expect((await repoA.professionalServices.listServices(prof.id))!.map((s) => s.id)).toEqual([s1.id]);

    expect(await repoA.professionalServices.setServices(prof.id, [s2.id])).toBe(true);
    expect((await repoA.professionalServices.listServices(prof.id))!.map((s) => s.id)).toEqual([s2.id]);

    expect(await repoA.professionalServices.unlink(prof.id, s2.id)).toBe(true);
    expect(await repoA.professionalServices.listServices(prof.id)).toEqual([]);
  });

  it("banco recusa duração fora de 5..480 / não múltipla de 5 e preço negativo", async () => {
    for (const durationMinutes of [0, 7, 485]) {
      await expect(repoA.services.create({ name: "x", durationMinutes, priceCents: 0 })).rejects.toThrow();
    }
    await expect(repoA.services.create({ name: "x", durationMinutes: 30, priceCents: -1 })).rejects.toThrow();
  });

  it("horários: vários intervalos por dia, encostar pode, sobrepor não (inclusive no banco)", async () => {
    const prof = await repoA.professionals.create({ name: "Gil (A)" });
    await repoA.workingHours.create(prof.id, { weekday: 1, start: "08:00", end: "12:00" });
    await repoA.workingHours.create(prof.id, { weekday: 1, start: "12:00", end: "18:00" });
    await expect(
      repoA.workingHours.create(prof.id, { weekday: 1, start: "11:00", end: "13:00" }),
    ).rejects.toThrow(WorkingHoursOverlapError);
    // Outro dia, mesmo horário: ok.
    await repoA.workingHours.create(prof.id, { weekday: 2, start: "11:00", end: "13:00" });

    const hours = await repoA.workingHours.list(prof.id);
    expect(hours!.map((h) => [h.weekday, h.startMinute, h.endMinute])).toEqual([
      [1, 480, 720],
      [1, 720, 1080],
      [2, 660, 780],
    ]);
  });

  it("horários: duas gravações sobrepostas ao mesmo tempo, só uma entra", async () => {
    const prof = await repoA.professionals.create({ name: "Jade (A)" });
    const results = await Promise.allSettled([
      repoA.workingHours.create(prof.id, { weekday: 4, start: "09:00", end: "12:00" }),
      repoA.workingHours.create(prof.id, { weekday: 4, start: "10:00", end: "13:00" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(WorkingHoursOverlapError);
    expect(await repoA.workingHours.list(prof.id)).toHaveLength(1);
  });

  it("horários: entrada inválida é barrada pelo Zod antes do banco", async () => {
    const prof = await repoA.professionals.create({ name: "Hugo (A)" });
    await expect(
      repoA.workingHours.create(prof.id, { weekday: 1, start: "10:00", end: "09:00" }),
    ).rejects.toThrow(ZodError);
    await expect(
      repoA.workingHours.replaceAll(prof.id, [
        { weekday: 3, start: "08:00", end: "12:00" },
        { weekday: 3, start: "11:30", end: "14:00" },
      ]),
    ).rejects.toThrow(ZodError);
    expect(await repoA.workingHours.list(prof.id)).toEqual([]);
  });

  it("horários: replaceAll troca a grade e delete apaga de verdade", async () => {
    const prof = await repoA.professionals.create({ name: "Iris (A)" });
    await repoA.workingHours.create(prof.id, { weekday: 0, start: "10:00", end: "14:00" });
    const grid = await repoA.workingHours.replaceAll(prof.id, [
      { weekday: 5, start: "13:00", end: "24:00" },
      { weekday: 5, start: "07:00", end: "12:00" },
    ]);
    expect(grid!.map((h) => [h.weekday, h.startMinute, h.endMinute])).toEqual([
      [5, 420, 720],
      [5, 780, 1440],
    ]);

    expect(await repoA.workingHours.delete(grid![0].id)).toBe(true);
    expect(await prisma.workingHours.findUnique({ where: { id: grid![0].id } })).toBeNull();
  });
});
