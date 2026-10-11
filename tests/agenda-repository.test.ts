import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Contact, Professional, Service, Tenant, TimeBlock } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  AppointmentConflictError,
  AppointmentStatusError,
  createTenantRepository,
  type AppointmentDetails,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 2: Contact, Appointment, TimeBlock e configurações da agenda pelo repositório (guia 5, 6;
// D5, D8). Isolamento por tenant inclusive por ID, e a EXCLUDE gist virando erro tipado.

let tenantA: Tenant;
let tenantB: Tenant;
let repoA: TenantRepository;
let repoB: TenantRepository;

let profA: Professional;
let profA2: Professional;
let serviceA: Service;
let contactA: Contact;

// Dados do tenant B que o tenant A tenta alcançar.
let profB: Professional;
let serviceB: Service;
let contactB: Contact;
let appointmentB: AppointmentDetails;
let blockB: TimeBlock;
const tokenB = randomBytes(32).toString("base64url");
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

// Datas fixas no futuro, em UTC.
const at = (iso: string) => new Date(`${iso}Z`);
const DAY = { startsAt: at("2031-03-10T00:00:00"), endsAt: at("2031-03-11T00:00:00") };

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTestTenant("ag-a"), createTestTenant("ag-b")]);
  repoA = createTenantRepository(tenantA.id);
  repoB = createTenantRepository(tenantB.id);

  [profA, profA2, serviceA] = await Promise.all([
    repoA.professionals.create({ name: "Ana (A)" }),
    repoA.professionals.create({ name: "Bruno (A)" }),
    repoA.services.create({ name: "Corte (A)", durationMinutes: 60, priceCents: 5000 }),
  ]);
  contactA = await repoA.contacts.findOrCreateByPhone({ name: "Carla (A)", phone: "+5511911110000" });

  [profB, serviceB] = await Promise.all([
    repoB.professionals.create({ name: "Bia (B)" }),
    repoB.services.create({ name: "Barba (B)", durationMinutes: 30, priceCents: 3000 }),
  ]);
  contactB = await repoB.contacts.findOrCreateByPhone(
    { name: "Davi (B)", phone: "+5511922220000", email: "davi@example.com" },
    { source: "public_booking" },
  );
  appointmentB = (await repoB.appointments.create({
    professionalId: profB.id,
    serviceId: serviceB.id,
    contactId: contactB.id,
    startsAt: at("2031-03-10T13:00:00"),
    endsAt: at("2031-03-10T13:30:00"),
    manageTokenHash: hashOf(tokenB),
  }))!;
  blockB = (await repoB.timeBlocks.create(profB.id, {
    startsAt: at("2031-03-10T15:00:00"),
    endsAt: at("2031-03-10T16:00:00"),
    reason: "Almoço",
  }))!;
});

afterAll(async () => {
  await deleteTestTenants(tenantA, tenantB);
  await prisma.$disconnect();
});

async function expectTenantBUntouched(): Promise<void> {
  const [tenant, contacts, appointments, blocks] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantB.id } }),
    prisma.contact.findMany({ where: { tenantId: tenantB.id } }),
    prisma.appointment.findMany({ where: { tenantId: tenantB.id } }),
    prisma.timeBlock.findMany({ where: { tenantId: tenantB.id } }),
  ]);
  expect(tenant).toMatchObject({
    name: tenantB.name,
    slug: tenantB.slug,
    description: null,
    slotStepMinutes: 15,
    bufferMinutes: 0,
    minAdvanceMinutes: 120,
    maxWindowDays: 60,
    cancelDeadlineMinutes: 120,
  });
  expect(contacts).toHaveLength(1);
  expect(contacts[0]).toMatchObject({ id: contactB.id, name: "Davi (B)", email: "davi@example.com" });
  expect(appointments).toHaveLength(1);
  expect(appointments[0]).toMatchObject({
    id: appointmentB.id,
    professionalId: profB.id,
    status: "confirmed",
    canceledAt: null,
    startsAt: at("2031-03-10T13:00:00"),
    endsAt: at("2031-03-10T13:30:00"),
  });
  expect(blocks.map((b) => b.id)).toEqual([blockB.id]);
}

function newAppointment(startIso: string, endIso: string, professionalId = profA.id) {
  return {
    professionalId,
    serviceId: serviceA.id,
    contactId: contactA.id,
    startsAt: at(startIso),
    endsAt: at(endIso),
  };
}

describe("configurações da agenda (D3)", () => {
  it("lê os padrões e grava só o próprio tenant", async () => {
    expect(await repoA.settings.get()).toMatchObject({
      slug: tenantA.slug,
      slotStepMinutes: 15,
      bufferMinutes: 0,
      minAdvanceMinutes: 120,
      maxWindowDays: 60,
      cancelDeadlineMinutes: 120,
    });
    const updated = await repoA.settings.update({
      description: "  Barbearia do bairro  ",
      address: "Rua A, 1",
      phone: "",
      slotStepMinutes: 30,
      bufferMinutes: 10,
      minAdvanceMinutes: 60,
      maxWindowDays: 30,
      cancelDeadlineMinutes: 240,
    });
    expect(updated).toMatchObject({
      description: "Barbearia do bairro",
      address: "Rua A, 1",
      phone: null,
      slotStepMinutes: 30,
      bufferMinutes: 10,
      minAdvanceMinutes: 60,
      maxWindowDays: 30,
      cancelDeadlineMinutes: 240,
    });
    expect(await repoA.settings.update({ bufferMinutes: 5 })).toMatchObject({ bufferMinutes: 5, slotStepMinutes: 30 });
    await expectTenantBUntouched();
  });

  it("recusa valores fora das faixas dos CHECKs e campos que não são de configuração", async () => {
    const invalid = [
      { slotStepMinutes: 7 },
      { slotStepMinutes: 0 },
      { slotStepMinutes: 125 },
      { bufferMinutes: -5 },
      { bufferMinutes: 3 },
      { minAdvanceMinutes: 43_201 },
      { maxWindowDays: 0 },
      { maxWindowDays: 366 },
      { cancelDeadlineMinutes: -1 },
      { cancelDeadlineMinutes: 1.5 },
      { description: "x".repeat(1001) },
    ];
    for (const input of invalid) {
      await expect(repoA.settings.update(input)).rejects.toThrow(ZodError);
    }
    // tenantId, slug e nome injetados não passam (schema estrito).
    for (const input of [{ tenantId: tenantB.id }, { slug: "outro" }, { name: "Outro" }]) {
      await expect(repoA.settings.update(input as object)).rejects.toThrow(ZodError);
    }
    expect((await repoA.settings.get())?.slug).toBe(tenantA.slug);
    await expectTenantBUntouched();
  });
});

describe("contatos (D5; D1 da Fatia 3)", () => {
  it("reencontra pelo telefone sem sobrescrever nome e e-mail", async () => {
    const again = await repoA.contacts.findOrCreateByPhone({ name: "Outro Nome", phone: "+5511911110000", email: "x@y.com" });
    expect(again).toMatchObject({ id: contactA.id, name: "Carla (A)", email: null });
    expect((await repoA.contacts.findByPhone("+5511911110000"))?.id).toBe(contactA.id);
  });

  it("registra o consentimento uma vez, com origem e data", async () => {
    const created = await repoA.contacts.findOrCreateByPhone({ name: "Eli (A)", phone: "+551133334444" });
    expect(created.consentAt).toBeNull();
    const first = new Date("2031-01-01T10:00:00Z");
    const consented = await repoA.contacts.findOrCreateByPhone(
      { name: "Eli (A)", phone: "+551133334444" },
      { source: "public_booking", at: first },
    );
    expect(consented).toMatchObject({ id: created.id, consentAt: first, consentSource: "public_booking" });
    const later = await repoA.contacts.findOrCreateByPhone(
      { name: "Eli (A)", phone: "+551133334444" },
      { source: "manual", at: new Date("2031-02-01T10:00:00Z") },
    );
    expect(later).toMatchObject({ consentAt: first, consentSource: "public_booking" });
  });

  it("dois cadastros simultâneos do mesmo telefone viram um cliente só", async () => {
    const input = { name: "Fê (A)", phone: "+5521955556666" };
    const [x, y] = await Promise.all([
      repoA.contacts.findOrCreateByPhone(input),
      repoA.contacts.findOrCreateByPhone(input),
    ]);
    expect(x.id).toBe(y.id);
  });

  it("recusa telefone não normalizado antes do banco", async () => {
    for (const phone of ["11987654321", "5511987654321", "(11) 98765-4321", "+55119876543210", "+5511187654321"]) {
      await expect(repoA.contacts.findOrCreateByPhone({ name: "Gui", phone })).rejects.toThrow(ZodError);
      expect(await repoA.contacts.findByPhone(phone)).toBeNull();
    }
  });

  it("o mesmo telefone em outro tenant é outro cliente", async () => {
    const inA = await repoA.contacts.findOrCreateByPhone({ name: "Davi (A)", phone: contactB.phone });
    expect(inA.id).not.toBe(contactB.id);
    expect(inA.tenantId).toBe(tenantA.id);
    await prisma.contact.delete({ where: { id: inA.id } });
  });

  it("tenant A não lê nem altera cliente do B, por ID ou telefone", async () => {
    expect(await repoA.contacts.findById(contactB.id)).toBeNull();
    expect(await repoA.contacts.findByPhone(contactB.phone)).toBeNull();
    expect(await repoA.contacts.update(contactB.id, { name: "Invadido" })).toBeNull();
    expect((await repoA.contacts.list()).some((c) => c.tenantId !== tenantA.id)).toBe(false);
    expect(await repoA.contacts.findById("nao-e-uuid")).toBeNull();
    await expectTenantBUntouched();
  });
});

describe("agendamentos: isolamento (guia 6)", () => {
  it("não cria com profissional, serviço ou cliente do B", async () => {
    const base = newAppointment("2031-03-10T08:00:00", "2031-03-10T09:00:00");
    expect(await repoA.appointments.create({ ...base, professionalId: profB.id })).toBeNull();
    expect(await repoA.appointments.create({ ...base, serviceId: serviceB.id })).toBeNull();
    expect(await repoA.appointments.create({ ...base, contactId: contactB.id })).toBeNull();
    expect(await repoA.appointments.listRange(DAY)).toEqual([]);
  });

  it("não lê, cancela, conclui nem remarca agendamento do B por ID", async () => {
    expect(await repoA.appointments.findById(appointmentB.id)).toBeNull();
    expect(await repoA.appointments.cancel(appointmentB.id)).toBeNull();
    expect(await repoA.appointments.complete(appointmentB.id)).toBeNull();
    expect(
      await repoA.appointments.reschedule(appointmentB.id, {
        startsAt: at("2031-03-10T18:00:00"),
        endsAt: at("2031-03-10T18:30:00"),
      }),
    ).toBeNull();
    // Remarcar o próprio agendamento para um profissional do B também não passa.
    const own = (await repoA.appointments.create(newAppointment("2031-03-12T10:00:00", "2031-03-12T11:00:00")))!;
    expect(
      await repoA.appointments.reschedule(own.id, { ...DAY, professionalId: profB.id }),
    ).toBeNull();
    expect((await repoA.appointments.findById(own.id))?.professionalId).toBe(profA.id);
    await expectTenantBUntouched();
  });

  it("não acha agendamento do B pelo hash do token de gestão", async () => {
    expect(await repoA.appointments.findByManageTokenHash(hashOf(tokenB))).toBeNull();
    expect((await repoB.appointments.findByManageTokenHash(hashOf(tokenB)))?.id).toBe(appointmentB.id);
    expect(await repoB.appointments.findByManageTokenHash(tokenB)).toBeNull();
  });

  it("listagem por intervalo traz só o próprio tenant", async () => {
    const list = await repoB.appointments.listRange(DAY);
    expect(list.map((a) => a.id)).toEqual([appointmentB.id]);
    expect(list[0]).toMatchObject({
      professional: { id: profB.id, name: "Bia (B)" },
      service: { id: serviceB.id, name: "Barba (B)", durationMinutes: 30 },
      contact: { id: contactB.id, name: "Davi (B)", phone: contactB.phone },
    });
    const fromA = await repoA.appointments.listRange({ ...DAY, professionalId: profB.id });
    expect(fromA).toEqual([]);
  });

  it("ID malformado se comporta como inexistente", async () => {
    expect(await repoA.appointments.findById("1 or 1=1")).toBeNull();
    expect(await repoA.appointments.cancel("")).toBeNull();
    expect(await repoA.appointments.listRange({ ...DAY, professionalId: "x" })).toEqual([]);
  });
});

describe("agendamentos: sobreposição vira erro tipado (D8)", () => {
  it("mesmo profissional sobreposto: AppointmentConflictError; encostar e outro profissional pode", async () => {
    const first = await repoA.appointments.create(newAppointment("2031-03-11T10:00:00", "2031-03-11T11:00:00"));
    expect(first).toMatchObject({ status: "confirmed", manageTokenHash: null, canceledAt: null });

    await expect(
      repoA.appointments.create(newAppointment("2031-03-11T10:30:00", "2031-03-11T11:30:00")),
    ).rejects.toThrow(AppointmentConflictError);
    await expect(
      repoA.appointments.create(newAppointment("2031-03-11T10:15:00", "2031-03-11T10:45:00")),
    ).rejects.toThrow(AppointmentConflictError);

    expect(await repoA.appointments.create(newAppointment("2031-03-11T11:00:00", "2031-03-11T12:00:00"))).not.toBeNull();
    expect(
      await repoA.appointments.create(newAppointment("2031-03-11T10:00:00", "2031-03-11T11:00:00", profA2.id)),
    ).not.toBeNull();
  });

  it("duas gravações simultâneas no mesmo horário: uma entra, a outra leva o erro tipado", async () => {
    const results = await Promise.allSettled([
      repoA.appointments.create(newAppointment("2031-03-13T09:00:00", "2031-03-13T10:00:00")),
      repoA.appointments.create(newAppointment("2031-03-13T09:30:00", "2031-03-13T10:30:00")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AppointmentConflictError);
    const day = await repoA.appointments.listRange({
      startsAt: at("2031-03-13T00:00:00"),
      endsAt: at("2031-03-14T00:00:00"),
    });
    expect(day).toHaveLength(1);
  });

  it("remarcar para horário ocupado ou para profissional ocupado dá conflito e não muda nada", async () => {
    const busy = (await repoA.appointments.create(newAppointment("2031-03-14T09:00:00", "2031-03-14T10:00:00")))!;
    const busyOther = (await repoA.appointments.create(
      newAppointment("2031-03-14T14:00:00", "2031-03-14T15:00:00", profA2.id),
    ))!;
    const moving = (await repoA.appointments.create(newAppointment("2031-03-14T12:00:00", "2031-03-14T13:00:00")))!;

    await expect(
      repoA.appointments.reschedule(moving.id, { startsAt: at("2031-03-14T09:30:00"), endsAt: at("2031-03-14T10:30:00") }),
    ).rejects.toThrow(AppointmentConflictError);
    await expect(
      repoA.appointments.reschedule(moving.id, {
        startsAt: at("2031-03-14T14:00:00"),
        endsAt: at("2031-03-14T15:00:00"),
        professionalId: profA2.id,
      }),
    ).rejects.toThrow(AppointmentConflictError);
    expect(await repoA.appointments.findById(moving.id)).toMatchObject({
      professionalId: profA.id,
      startsAt: at("2031-03-14T12:00:00"),
    });

    // Remarcar sobre o próprio horário antigo pode (a constraint ignora a própria linha).
    const moved = await repoA.appointments.reschedule(moving.id, {
      startsAt: at("2031-03-14T12:30:00"),
      endsAt: at("2031-03-14T13:30:00"),
    });
    expect(moved).toMatchObject({ startsAt: at("2031-03-14T12:30:00"), status: "confirmed" });
    expect([busy.id, busyOther.id]).not.toContain(moved!.id);
  });

  it("cancelar libera o horário; reconfirmar não existe (só confirmed muda)", async () => {
    const appointment = (await repoA.appointments.create(
      newAppointment("2031-03-15T09:00:00", "2031-03-15T10:00:00"),
    ))!;
    const canceledAt = new Date("2031-03-01T12:00:00Z");
    const canceled = await repoA.appointments.cancel(appointment.id, canceledAt);
    expect(canceled).toMatchObject({ status: "canceled", canceledAt });
    // Cancelar de novo devolve o mesmo, sem trocar a data.
    expect(await repoA.appointments.cancel(appointment.id)).toMatchObject({ status: "canceled", canceledAt });

    const replacement = await repoA.appointments.create(newAppointment("2031-03-15T09:00:00", "2031-03-15T10:00:00"));
    expect(replacement?.status).toBe("confirmed");

    await expect(repoA.appointments.complete(appointment.id)).rejects.toThrow(AppointmentStatusError);
    await expect(
      repoA.appointments.reschedule(appointment.id, { startsAt: at("2031-03-15T16:00:00"), endsAt: at("2031-03-15T17:00:00") }),
    ).rejects.toThrow(AppointmentStatusError);
  });

  it("concluir: confirmed vira completed, que não cancela nem remarca", async () => {
    const appointment = (await repoA.appointments.create(
      newAppointment("2031-03-16T09:00:00", "2031-03-16T10:00:00"),
    ))!;
    expect(await repoA.appointments.complete(appointment.id)).toMatchObject({ status: "completed", canceledAt: null });
    expect(await repoA.appointments.complete(appointment.id)).toMatchObject({ status: "completed" });
    const error = await repoA.appointments.cancel(appointment.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppointmentStatusError);
    expect((error as AppointmentStatusError).status).toBe("completed");
  });

  it("fim <= início e hash de token malformado são barrados antes do banco", async () => {
    await expect(
      repoA.appointments.create(newAppointment("2031-03-17T10:00:00", "2031-03-17T10:00:00")),
    ).rejects.toThrow(ZodError);
    await expect(
      repoA.appointments.create({
        ...newAppointment("2031-03-17T10:00:00", "2031-03-17T11:00:00"),
        manageTokenHash: "token-puro",
      }),
    ).rejects.toThrow(TypeError);
  });

  it("listRange pega o que cruza a janela e filtra por status e profissional", async () => {
    const window = { startsAt: at("2031-03-18T10:00:00"), endsAt: at("2031-03-18T12:00:00") };
    const crossingStart = (await repoA.appointments.create(newAppointment("2031-03-18T09:30:00", "2031-03-18T10:30:00")))!;
    const inside = (await repoA.appointments.create(newAppointment("2031-03-18T11:00:00", "2031-03-18T11:30:00")))!;
    await repoA.appointments.create(newAppointment("2031-03-18T12:00:00", "2031-03-18T13:00:00")); // só encosta
    const other = (await repoA.appointments.create(
      newAppointment("2031-03-18T10:00:00", "2031-03-18T11:00:00", profA2.id),
    ))!;
    await repoA.appointments.cancel(inside.id);

    const all = await repoA.appointments.listRange(window);
    expect(all.map((a) => a.id)).toEqual([crossingStart.id, other.id, inside.id]);
    const confirmedOfA = await repoA.appointments.listRange({
      ...window,
      professionalId: profA.id,
      statuses: ["confirmed"],
    });
    expect(confirmedOfA.map((a) => a.id)).toEqual([crossingStart.id]);
  });
});

describe("bloqueios (D9)", () => {
  it("cria, lista por intervalo e apaga no próprio tenant", async () => {
    const block = await repoA.timeBlocks.create(profA.id, {
      startsAt: at("2031-03-20T11:00:00"),
      endsAt: at("2031-03-20T13:00:00"),
      reason: "  ",
    });
    expect(block).toMatchObject({ tenantId: tenantA.id, professionalId: profA.id, reason: null });
    const list = await repoA.timeBlocks.listRange({
      startsAt: at("2031-03-20T12:00:00"),
      endsAt: at("2031-03-20T18:00:00"),
      professionalId: profA.id,
    });
    expect(list.map((b) => b.id)).toEqual([block!.id]);
    expect(await repoA.timeBlocks.delete(block!.id)).toBe(true);
    expect(await repoA.timeBlocks.findById(block!.id)).toBeNull();
  });

  it("tenant A não cria, lê nem apaga bloqueio do B", async () => {
    expect(
      await repoA.timeBlocks.create(profB.id, { startsAt: at("2031-03-10T08:00:00"), endsAt: at("2031-03-10T09:00:00") }),
    ).toBeNull();
    expect(await repoA.timeBlocks.findById(blockB.id)).toBeNull();
    expect(await repoA.timeBlocks.delete(blockB.id)).toBe(false);
    expect(await repoA.timeBlocks.listRange({ ...DAY, professionalId: profB.id })).toEqual([]);
    expect((await repoA.timeBlocks.listRange(DAY)).some((b) => b.tenantId !== tenantA.id)).toBe(false);
    await expectTenantBUntouched();
  });

  it("fim <= início é barrado pelo Zod", async () => {
    await expect(
      repoA.timeBlocks.create(profA.id, { startsAt: at("2031-03-20T11:00:00"), endsAt: at("2031-03-20T10:00:00") }),
    ).rejects.toThrow(ZodError);
  });
});
