import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contact, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  evaluateEligibility,
  isContactEligibleForProactive,
  RECENT_INBOUND_WINDOW_MS,
} from "@/server/outbound/eligibility";
import {
  createTenantRepository,
  type EligibilityFacts,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 3: elegibilidade para mensagem proativa (guia 6; D13). Primeiro a regra pura (cada regra
// isolada, nenhuma, fronteira dos 30 dias, opt_out vence tudo); depois a leitura pelo repositório
// na branch test (agendamento cancelado não conta, contato de outro tenant nunca é considerado).

const NOW = new Date("2026-10-11T15:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const none: EligibilityFacts = {
  optOut: false,
  lastInboundAt: null,
  consentAt: null,
  hasConfirmedAppointment: false,
  hasActivePlan: false,
  hasActiveCharge: false,
};
const facts = (input: Partial<EligibilityFacts>): EligibilityFacts => ({ ...none, ...input });

describe("evaluateEligibility (regra pura)", () => {
  it("sem nenhuma regra: bloqueado com not_eligible", () => {
    expect(evaluateEligibility(none, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("contato inexistente: bloqueado com contact_not_found", () => {
    expect(evaluateEligibility(null, NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
  });

  it("regra (a) isolada: escreveu há 1 dia", () => {
    expect(evaluateEligibility(facts({ lastInboundAt: ago(DAY_MS) }), NOW)).toEqual({
      eligible: true,
      reason: "recent_inbound",
    });
  });

  it("regra (b) isolada: agendamento confirmed", () => {
    expect(evaluateEligibility(facts({ hasConfirmedAppointment: true }), NOW)).toEqual({
      eligible: true,
      reason: "active_commitment",
    });
  });

  it("regra (b) isolada: plano ativo e cobrança ativa", () => {
    expect(evaluateEligibility(facts({ hasActivePlan: true }), NOW)).toEqual({
      eligible: true,
      reason: "active_commitment",
    });
    expect(evaluateEligibility(facts({ hasActiveCharge: true }), NOW)).toEqual({
      eligible: true,
      reason: "active_commitment",
    });
  });

  it("regra (c) isolada: consentimento registrado, mesmo antigo", () => {
    expect(evaluateEligibility(facts({ consentAt: ago(400 * DAY_MS) }), NOW)).toEqual({
      eligible: true,
      reason: "registered_consent",
    });
  });

  describe("fronteira dos 30 dias", () => {
    it("exatamente 30 dias: elegível", () => {
      const result = evaluateEligibility(facts({ lastInboundAt: ago(RECENT_INBOUND_WINDOW_MS) }), NOW);
      expect(result).toEqual({ eligible: true, reason: "recent_inbound" });
    });

    it("30 dias e 1 ms: não elegível", () => {
      const result = evaluateEligibility(facts({ lastInboundAt: ago(RECENT_INBOUND_WINDOW_MS + 1) }), NOW);
      expect(result).toEqual({ eligible: false, reason: "not_eligible" });
    });

    it("29 dias e 23 h: elegível; 31 dias: não", () => {
      expect(evaluateEligibility(facts({ lastInboundAt: ago(30 * DAY_MS - 3_600_000) }), NOW).eligible).toBe(true);
      expect(evaluateEligibility(facts({ lastInboundAt: ago(31 * DAY_MS) }), NOW).eligible).toBe(false);
    });

    it("conversa antiga não impede outra regra", () => {
      const result = evaluateEligibility(facts({ lastInboundAt: ago(60 * DAY_MS), consentAt: ago(90 * DAY_MS) }), NOW);
      expect(result).toEqual({ eligible: true, reason: "registered_consent" });
    });
  });

  describe("opt_out vence qualquer regra", () => {
    const cases: [string, Partial<EligibilityFacts>][] = [
      ["regra (a)", { lastInboundAt: ago(60_000) }],
      ["agendamento confirmed", { hasConfirmedAppointment: true }],
      ["plano ativo", { hasActivePlan: true }],
      ["cobrança ativa", { hasActiveCharge: true }],
      ["regra (c)", { consentAt: ago(DAY_MS) }],
      [
        "todas juntas",
        {
          lastInboundAt: ago(60_000),
          consentAt: ago(DAY_MS),
          hasConfirmedAppointment: true,
          hasActivePlan: true,
          hasActiveCharge: true,
        },
      ],
      ["nenhuma", {}],
    ];
    it.each(cases)("%s + opt_out: bloqueado com opt_out", (_label, input) => {
      expect(evaluateEligibility(facts({ ...input, optOut: true }), NOW)).toEqual({
        eligible: false,
        reason: "opt_out",
      });
    });
  });

  it("motivos cabem no formato de block_reason do banco", () => {
    for (const reason of ["opt_out", "not_eligible", "contact_not_found"]) {
      expect(reason).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });
});

describe("isContactEligibleForProactive (repositório, branch test)", () => {
  let tenantA: Tenant;
  let tenantB: Tenant;
  let repoA: TenantRepository;
  let repoB: TenantRepository;
  let professionalId: string;
  let serviceId: string;
  let hour = 0;

  const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

  async function contact(repo: TenantRepository, data: Partial<Contact> = {}, at = phone()): Promise<Contact> {
    const created = await repo.contacts.findOrCreateByPhone({ name: "Cliente", phone: at });
    return prisma.contact.update({ where: { id: created.id }, data });
  }

  // Agendamentos em horários distintos do mesmo profissional (a EXCLUDE barra sobreposição).
  async function appointment(contactId: string): Promise<string> {
    const startsAt = new Date(NOW.getTime() + (24 + hour++) * 3_600_000);
    const created = await repoA.appointments.create({
      professionalId,
      serviceId,
      contactId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    });
    if (!created) throw new Error("agendamento de teste não criado");
    return created.id;
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await Promise.all([createTestTenant("eleg-a"), createTestTenant("eleg-b")]);
    repoA = createTenantRepository(tenantA.id);
    repoB = createTenantRepository(tenantB.id);
    const professional = await repoA.professionals.create({ name: "Ana" });
    const service = await repoA.services.create({ name: "Corte", durationMinutes: 30, priceCents: 5000 });
    professionalId = professional.id;
    serviceId = service.id;
  });

  afterAll(async () => {
    await deleteTestTenants(tenantA, tenantB);
  });

  it("sem nenhuma regra: not_eligible", async () => {
    const c = await contact(repoA);
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("regra (a) pelo last_inbound_at, com a fronteira dos 30 dias", async () => {
    const recent = await contact(repoA, { lastInboundAt: ago(RECENT_INBOUND_WINDOW_MS) });
    const old = await contact(repoA, { lastInboundAt: ago(RECENT_INBOUND_WINDOW_MS + 1) });
    expect(await isContactEligibleForProactive(repoA, recent.id, NOW)).toEqual({ eligible: true, reason: "recent_inbound" });
    expect(await isContactEligibleForProactive(repoA, old.id, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("regra (b): agendamento confirmed conta (D13)", async () => {
    const c = await contact(repoA);
    await appointment(c.id);
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: true, reason: "active_commitment" });
  });

  it("agendamento cancelado não conta", async () => {
    const c = await contact(repoA);
    const id = await appointment(c.id);
    expect(await repoA.appointments.cancel(id, NOW)).not.toBeNull();
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("agendamento concluído não conta", async () => {
    const c = await contact(repoA);
    const id = await appointment(c.id);
    expect(await repoA.appointments.complete(id)).not.toBeNull();
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("cancelado mais um confirmed: elegível pelo confirmed", async () => {
    const c = await contact(repoA);
    await repoA.appointments.cancel(await appointment(c.id), NOW);
    await appointment(c.id);
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: true, reason: "active_commitment" });
  });

  it("regra (c): consentimento registrado", async () => {
    const created = await repoA.contacts.findOrCreateByPhone(
      { name: "Cliente", phone: phone() },
      { source: "public_booking", at: ago(200 * DAY_MS) },
    );
    expect(await isContactEligibleForProactive(repoA, created.id, NOW)).toEqual({
      eligible: true,
      reason: "registered_consent",
    });
  });

  it("opt_out vence as três regras juntas", async () => {
    const c = await contact(repoA, { optOut: true, lastInboundAt: ago(60_000), consentAt: ago(DAY_MS), consentSource: "owner" });
    await appointment(c.id);
    expect(await isContactEligibleForProactive(repoA, c.id, NOW)).toEqual({ eligible: false, reason: "opt_out" });
  });

  describe("contato de outro tenant nunca é considerado", () => {
    it("ID do contato do B, lido pelo A: contact_not_found, mesmo elegível no B", async () => {
      const b = await contact(repoB, { lastInboundAt: ago(60_000), consentAt: ago(DAY_MS), consentSource: "owner" });
      expect(await isContactEligibleForProactive(repoB, b.id, NOW)).toEqual({ eligible: true, reason: "recent_inbound" });
      expect(await isContactEligibleForProactive(repoA, b.id, NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
    });

    it("mesmo telefone nos dois tenants: os fatos do B não tornam o A elegível", async () => {
      const shared = phone();
      const a = await contact(repoA, {}, shared);
      const b = await contact(repoB, { lastInboundAt: ago(60_000), consentAt: ago(DAY_MS), consentSource: "owner" }, shared);
      expect(a.id).not.toBe(b.id);
      expect(await isContactEligibleForProactive(repoA, a.id, NOW)).toEqual({ eligible: false, reason: "not_eligible" });
    });

    it("opt_out do B não bloqueia o contato do A com o mesmo telefone", async () => {
      const shared = phone();
      const a = await contact(repoA, { consentAt: ago(DAY_MS), consentSource: "owner" }, shared);
      await contact(repoB, { optOut: true }, shared);
      expect(await isContactEligibleForProactive(repoA, a.id, NOW)).toEqual({ eligible: true, reason: "registered_consent" });
    });

    it("agendamento confirmed do A não vale para o B", async () => {
      const a = await contact(repoA);
      await appointment(a.id);
      expect(await isContactEligibleForProactive(repoB, a.id, NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
    });

    it("ID inexistente ou malformado: contact_not_found sem erro", async () => {
      expect(await isContactEligibleForProactive(repoA, randomUUID(), NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
      expect(await isContactEligibleForProactive(repoA, "nao-e-uuid", NOW)).toEqual({ eligible: false, reason: "contact_not_found" });
    });
  });

  it("sem now, usa a hora atual", async () => {
    const c = await contact(repoA, { lastInboundAt: new Date(Date.now() - DAY_MS) });
    expect(await isContactEligibleForProactive(repoA, c.id)).toEqual({ eligible: true, reason: "recent_inbound" });
  });
});
