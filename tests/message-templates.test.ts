import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contact, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { OUTBOUND_MESSAGE_TYPES, type OutboundMessageType } from "@/server/outbound/message-types";
import {
  DEFAULT_TEMPLATES,
  MAX_VARIATION_LENGTH,
  normalizeVariations,
  pickVariation,
  renderTemplate,
  TemplateValidationError,
  UnknownMessageTypeError,
  validateVariations,
} from "@/server/outbound/templates";
import { createAuthRepository } from "@/server/repositories/auth-repository";
import { backfillDefaultTemplates } from "@/server/repositories/message-templates-backfill";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 5: templates (guia 5, 6; D5, D16). Primeiro a parte pura (validação, montagem, escolha sem
// repetir); depois o repositório na branch test (padrões no cadastro e nos tenants existentes,
// edição validada, tipo fora da lista fechada, isolamento por tenant inclusive por ID).

const valid = (...extra: string[]) => ["Oi, {{nome}}!", "Olá, {{nome}}.", "{{nome}}, tudo certo?", ...extra];

const issueCodes = (type: unknown, variations: string[]) => validateVariations(type, variations).map((i) => i.code);

describe("validateVariations (regra pura)", () => {
  it("textos padrão de todos os tipos são válidos, com 3 ou mais variações", () => {
    for (const type of OUTBOUND_MESSAGE_TYPES) {
      expect(DEFAULT_TEMPLATES[type].length).toBeGreaterThanOrEqual(3);
      expect(validateVariations(type, [...DEFAULT_TEMPLATES[type]])).toEqual([]);
    }
  });

  it("variável desconhecida é recusada, com a variação e o nome", () => {
    expect(validateVariations("optout_confirmation", valid("Oi, {{cpf}}"))).toEqual([
      { code: "unknown_variable", index: 3, variable: "cpf" },
    ]);
  });

  it("variável de outro tipo é desconhecida neste tipo", () => {
    // {{hora}} existe em appointment_confirmation, não em optout_confirmation.
    expect(issueCodes("appointment_confirmation", valid("às {{hora}}"))).toEqual([]);
    expect(issueCodes("optout_confirmation", valid("às {{hora}}"))).toEqual(["unknown_variable"]);
  });

  it("variável com caixa diferente ou acento não é aceita", () => {
    expect(issueCodes("optout_confirmation", valid("{{Nome}}"))).toEqual(["unknown_variable"]);
    expect(issueCodes("optout_confirmation", valid("{{negócio}}"))).toEqual(["unknown_variable"]);
  });

  it("espaços dentro das chaves são aceitos", () => {
    expect(issueCodes("optout_confirmation", valid("{{ nome }} de {{negocio }}"))).toEqual([]);
  });

  it("variável mal formada é recusada", () => {
    for (const text of ["Oi {{nome", "Oi nome}}", "Oi {{}}", "{{nome}} {{", "{{nome {{negocio}}"]) {
      expect(issueCodes("optout_confirmation", valid(text))).toContain(
        text === "Oi {{}}" ? "unknown_variable" : "malformed_variable",
      );
    }
  });

  it("texto vazio ou só com espaços é recusado", () => {
    expect(validateVariations("optout_confirmation", valid(""))).toEqual([{ code: "empty", index: 3 }]);
    expect(validateVariations("optout_confirmation", ["   ", "\n\t", "Oi", "Olá"])).toEqual([
      { code: "empty", index: 0 },
      { code: "empty", index: 1 },
    ]);
  });

  it("menos de 3 ou mais de 10 variações são recusadas", () => {
    expect(issueCodes("optout_confirmation", ["Oi", "Olá"])).toEqual(["too_few"]);
    expect(issueCodes("optout_confirmation", [])).toEqual(["too_few"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `Texto ${i}`);
    expect(issueCodes("optout_confirmation", eleven)).toEqual(["too_many"]);
    expect(issueCodes("optout_confirmation", eleven.slice(0, 10))).toEqual([]);
  });

  it("variação longa demais e variação repetida são recusadas", () => {
    expect(issueCodes("optout_confirmation", valid("x".repeat(MAX_VARIATION_LENGTH)))).toEqual([]);
    expect(issueCodes("optout_confirmation", valid("x".repeat(MAX_VARIATION_LENGTH + 1)))).toEqual(["too_long"]);
    expect(validateVariations("optout_confirmation", valid("  Oi, {{nome}}! "))).toEqual([
      { code: "duplicate", index: 3 },
    ]);
  });

  it("tipo fora da lista fechada é recusado", () => {
    for (const type of ["appointment_reminder", "campanha", "", "APPOINTMENT_CONFIRMATION", null, 1]) {
      expect(() => validateVariations(type, valid())).toThrow(UnknownMessageTypeError);
    }
  });

  it("normalizeVariations tira os espaços das pontas e lança TemplateValidationError", () => {
    expect(normalizeVariations("optout_confirmation", [" a ", "b\n", "c"])).toEqual(["a", "b", "c"]);
    expect(() => normalizeVariations("optout_confirmation", valid("{{x}}"))).toThrow(TemplateValidationError);
  });
});

describe("renderTemplate", () => {
  it("troca as variáveis, inclusive com espaços e repetidas, como texto literal", () => {
    const text = "Oi {{nome}}, {{ negocio }} agradece, {{nome}}!";
    expect(renderTemplate<"optout_confirmation">(text, { nome: "Ana", negocio: "Studio $& <b>" })).toBe(
      "Oi Ana, Studio $& <b> agradece, Ana!",
    );
  });

  it("monta um texto padrão sem sobrar chave", () => {
    const values = { nome: "Ana", negocio: "Studio", servico: "Corte", profissional: "Bia", data: "12/10", hora: "14:00" };
    for (const text of DEFAULT_TEMPLATES.appointment_confirmation) {
      expect(renderTemplate<"appointment_confirmation">(text, values)).not.toMatch(/\{\{|\}\}/);
    }
  });
});

describe("pickVariation (regra pura)", () => {
  const fixed = (value: number) => () => value;

  it("nunca repete a última: varre o sorteio inteiro para cada última", () => {
    for (let last = 0; last < 4; last++) {
      const picked = new Set<number>();
      for (let r = 0; r < 1; r += 0.01) picked.add(pickVariation(4, last, fixed(r)));
      picked.add(pickVariation(4, last, fixed(0.9999999)));
      expect(picked.has(last)).toBe(false);
      expect(picked.size).toBe(3);
    }
  });

  it("10.000 sorteios reais: nenhuma repetição e todas as outras aparecem", () => {
    let last = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const next = pickVariation(3, last);
      expect(next).not.toBe(last);
      seen.add(next);
      last = next;
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it("sem histórico ou com última fora da lista: sorteia entre todas", () => {
    expect(pickVariation(3, null, fixed(0))).toBe(0);
    expect(pickVariation(3, null, fixed(0.9999))).toBe(2);
    expect(pickVariation(3, 7, fixed(0.9999))).toBe(2);
    expect(pickVariation(3, -1, fixed(0))).toBe(0);
  });

  it("sem variações lança erro", () => {
    expect(() => pickVariation(0, null)).toThrow(RangeError);
  });
});

describe("repositório de templates (branch test)", () => {
  let tenantA: Tenant;
  let tenantB: Tenant;
  let repoA: TenantRepository;
  let repoB: TenantRepository;
  let contactA: Contact;
  let otherContactA: Contact;
  const signupTenantIds: string[] = [];

  const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const createContact = (tenantId: string) =>
    prisma.contact.create({ data: { tenantId, name: "Cliente", phone: phone() } });
  const recordSend = (tenantId: string, contactId: string, messageType: OutboundMessageType, templateVariant: number) =>
    prisma.outboundMessage.create({
      data: { tenantId, contactId, messageType, templateVariant, idempotencyKey: `teste-${randomUUID()}` },
    });

  beforeAll(async () => {
    tenantA = await createTestTenant("templates-a");
    tenantB = await createTestTenant("templates-b");
    repoA = createTenantRepository(tenantA.id);
    repoB = createTenantRepository(tenantB.id);
    contactA = await createContact(tenantA.id);
    otherContactA = await createContact(tenantA.id);
  });

  afterAll(async () => {
    await deleteTestTenants(tenantA, tenantB);
    if (signupTenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: signupTenantIds } } });
  });

  describe("textos padrão", () => {
    it("tenant novo pelo cadastro já nasce com os templates padrão de cada tipo", async () => {
      const suffix = randomUUID().slice(0, 8);
      const account = await createAuthRepository().createOwnerAccount({
        tenantName: "Cadastro templates",
        slug: `teste-templates-cadastro-${suffix}`,
        email: `templates-${suffix}@teste.slotz`,
        passwordHash: "x",
        session: { tokenHash: `templates-${suffix}`, expiresAt: new Date(Date.now() + 60_000) },
      });
      signupTenantIds.push(account.tenant.id);
      const rows = await prisma.messageTemplate.findMany({ where: { tenantId: account.tenant.id } });
      expect(rows.map((r) => r.messageType).sort()).toEqual([...OUTBOUND_MESSAGE_TYPES].sort());
      for (const row of rows) {
        expect(row.variations).toEqual(DEFAULT_TEMPLATES[row.messageType as OutboundMessageType]);
        expect(row.active).toBe(true);
      }
    });

    it("tenant existente sem templates: o backfill cria, não duplica e não sobrescreve o editado", async () => {
      const legacy = await createTestTenant("templates-legado");
      try {
        expect(await prisma.messageTemplate.count({ where: { tenantId: legacy.id } })).toBe(0);
        const first = await backfillDefaultTemplates(prisma);
        expect(first.created).toBeGreaterThanOrEqual(OUTBOUND_MESSAGE_TYPES.length);
        expect(await prisma.messageTemplate.count({ where: { tenantId: legacy.id } })).toBe(2);

        const repo = createTenantRepository(legacy.id);
        const edited = valid("{{nome}}, até logo.");
        const template = await repo.messageTemplates.getByType("optout_confirmation");
        await repo.messageTemplates.updateVariations(template.id, edited);

        await backfillDefaultTemplates(prisma);
        expect(await prisma.messageTemplate.count({ where: { tenantId: legacy.id } })).toBe(2);
        expect((await repo.messageTemplates.getByType("optout_confirmation")).variations).toEqual(edited);
      } finally {
        await deleteTestTenants(legacy);
      }
    });

    it("tenant existente sem backfill: a primeira leitura cria o padrão", async () => {
      const legacy = await createTestTenant("templates-leitura");
      try {
        const repo = createTenantRepository(legacy.id);
        const template = await repo.messageTemplates.getByType("appointment_confirmation");
        expect(template.tenantId).toBe(legacy.id);
        expect(template.variations).toEqual(DEFAULT_TEMPLATES.appointment_confirmation);
        expect((await repo.messageTemplates.list()).map((t) => t.messageType)).toEqual([...OUTBOUND_MESSAGE_TYPES]);
      } finally {
        await deleteTestTenants(legacy);
      }
    });
  });

  describe("edição validada", () => {
    it("variação válida é gravada sem os espaços das pontas", async () => {
      const template = await repoA.messageTemplates.getByType("optout_confirmation");
      const saved = await repoA.messageTemplates.updateVariations(template.id, [" Oi, {{nome}}! ", "Olá", "Tchau, {{negocio}}"]);
      expect(saved?.variations).toEqual(["Oi, {{nome}}!", "Olá", "Tchau, {{negocio}}"]);
    });

    it("variável desconhecida é recusada e nada muda no banco", async () => {
      const template = await repoA.messageTemplates.getByType("optout_confirmation");
      const error = await repoA.messageTemplates
        .updateVariations(template.id, valid("Seu CPF é {{cpf}}"))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TemplateValidationError);
      expect((error as TemplateValidationError).issues).toEqual([{ code: "unknown_variable", index: 3, variable: "cpf" }]);
      expect((await repoA.messageTemplates.findById(template.id))?.variations).toEqual(template.variations);
    });

    it("texto vazio é recusado e nada muda no banco", async () => {
      const template = await repoA.messageTemplates.getByType("appointment_confirmation");
      for (const empty of ["", "   "]) {
        await expect(repoA.messageTemplates.updateVariations(template.id, valid(empty))).rejects.toBeInstanceOf(
          TemplateValidationError,
        );
      }
      await expect(repoA.messageTemplates.updateVariations(template.id, ["Oi", "Olá"])).rejects.toBeInstanceOf(
        TemplateValidationError,
      );
      expect((await repoA.messageTemplates.findById(template.id))?.variations).toEqual(template.variations);
    });

    it("restaurar padrão volta aos textos do código", async () => {
      const template = await repoA.messageTemplates.getByType("optout_confirmation");
      await repoA.messageTemplates.updateVariations(template.id, valid());
      const restored = await repoA.messageTemplates.restoreDefault("optout_confirmation");
      expect(restored.id).toBe(template.id);
      expect(restored.variations).toEqual(DEFAULT_TEMPLATES.optout_confirmation);
    });
  });

  describe("tipo fora da lista fechada", () => {
    it("é recusado em todas as operações por tipo, sem criar nada", async () => {
      const before = await prisma.messageTemplate.count({ where: { tenantId: tenantA.id } });
      for (const type of ["appointment_reminder", "campanha", "", null]) {
        await expect(repoA.messageTemplates.getByType(type)).rejects.toBeInstanceOf(UnknownMessageTypeError);
        await expect(repoA.messageTemplates.restoreDefault(type)).rejects.toBeInstanceOf(UnknownMessageTypeError);
        await expect(repoA.messageTemplates.lastVariantFor(contactA.id, type)).rejects.toBeInstanceOf(
          UnknownMessageTypeError,
        );
        await expect(repoA.messageTemplates.chooseFor(contactA.id, type)).rejects.toBeInstanceOf(UnknownMessageTypeError);
      }
      expect(await prisma.messageTemplate.count({ where: { tenantId: tenantA.id } })).toBe(before);
    });

    it("o banco também recusa, mesmo contornando o repositório", async () => {
      await expect(
        prisma.messageTemplate.create({ data: { tenantId: tenantA.id, messageType: "campanha", variations: valid() } }),
      ).rejects.toThrow(/message_templates_message_type_check/);
    });
  });

  describe("isolamento por tenant", () => {
    it("tenant B não lê nem edita o template de A pelo ID", async () => {
      const templateA = await repoA.messageTemplates.getByType("appointment_confirmation");
      expect(await repoB.messageTemplates.findById(templateA.id)).toBeNull();
      expect(await repoB.messageTemplates.updateVariations(templateA.id, valid())).toBeNull();
      // Nem uma edição inválida vaza que o ID existe: devolve null antes de validar.
      expect(await repoB.messageTemplates.updateVariations(templateA.id, ["{{cpf}}"])).toBeNull();
      expect((await repoA.messageTemplates.findById(templateA.id))?.variations).toEqual(templateA.variations);
    });

    it("listas e leituras por tipo devolvem só os templates do próprio tenant", async () => {
      const listA = await repoA.messageTemplates.list();
      const listB = await repoB.messageTemplates.list();
      expect(listA.every((t) => t.tenantId === tenantA.id)).toBe(true);
      expect(listB.every((t) => t.tenantId === tenantB.id)).toBe(true);
      expect(listB.map((t) => t.id)).not.toContain(listA[0].id);
      const typeB = await repoB.messageTemplates.getByType("appointment_confirmation");
      expect(typeB.tenantId).toBe(tenantB.id);
    });

    it("edição em A não muda o template do mesmo tipo em B", async () => {
      const templateA = await repoA.messageTemplates.getByType("appointment_confirmation");
      const beforeB = await repoB.messageTemplates.getByType("appointment_confirmation");
      await repoA.messageTemplates.updateVariations(templateA.id, valid("{{hora}} ok"));
      expect((await repoB.messageTemplates.getByType("appointment_confirmation")).variations).toEqual(beforeB.variations);
      await repoA.messageTemplates.restoreDefault("appointment_confirmation");
    });

    it("ID malformado se comporta como inexistente", async () => {
      expect(await repoA.messageTemplates.findById("nao-e-uuid")).toBeNull();
      expect(await repoA.messageTemplates.updateVariations("nao-e-uuid", valid())).toBeNull();
      expect(await repoA.messageTemplates.lastVariantFor("nao-e-uuid", "appointment_confirmation")).toBeNull();
    });

    it("histórico de envio de A não é lido por B, mesmo com o ID do contato", async () => {
      await recordSend(tenantA.id, contactA.id, "optout_confirmation", 2);
      expect(await repoA.messageTemplates.lastVariantFor(contactA.id, "optout_confirmation")).toBe(2);
      expect(await repoB.messageTemplates.lastVariantFor(contactA.id, "optout_confirmation")).toBeNull();
    });
  });

  describe("escolha sem repetir a última do contato", () => {
    it("a última variação vem do envio mais recente do mesmo tipo e contato", async () => {
      const contact = await createContact(tenantA.id);
      expect(await repoA.messageTemplates.lastVariantFor(contact.id, "appointment_confirmation")).toBeNull();
      await recordSend(tenantA.id, contact.id, "appointment_confirmation", 0);
      await recordSend(tenantA.id, contact.id, "appointment_confirmation", 2);
      await recordSend(tenantA.id, contact.id, "optout_confirmation", 1);
      expect(await repoA.messageTemplates.lastVariantFor(contact.id, "appointment_confirmation")).toBe(2);
      expect(await repoA.messageTemplates.lastVariantFor(contact.id, "optout_confirmation")).toBe(1);
    });

    it("chooseFor nunca devolve a última, para qualquer sorteio", async () => {
      await recordSend(tenantA.id, contactA.id, "appointment_confirmation", 1);
      const template = await repoA.messageTemplates.getByType("appointment_confirmation");
      for (const r of [0, 0.3, 0.49, 0.5, 0.75, 0.9999]) {
        const chosen = await repoA.messageTemplates.chooseFor(contactA.id, "appointment_confirmation", () => r);
        expect(chosen.variant).not.toBe(1);
        expect(chosen.templateId).toBe(template.id);
        expect(chosen.text).toBe(template.variations[chosen.variant]);
      }
    });

    it("20 envios seguidos ao mesmo contato: nenhuma variação repetida em sequência", async () => {
      const contact = await createContact(tenantA.id);
      const used: number[] = [];
      for (let i = 0; i < 20; i++) {
        const chosen = await repoA.messageTemplates.chooseFor(contact.id, "optout_confirmation");
        await recordSend(tenantA.id, contact.id, "optout_confirmation", chosen.variant);
        used.push(chosen.variant);
      }
      for (let i = 1; i < used.length; i++) expect(used[i]).not.toBe(used[i - 1]);
    });

    it("a última de um contato não restringe outro contato", async () => {
      await recordSend(tenantA.id, contactA.id, "optout_confirmation", 0);
      const forA = await repoA.messageTemplates.chooseFor(contactA.id, "optout_confirmation", () => 0);
      const forOther = await repoA.messageTemplates.chooseFor(otherContactA.id, "optout_confirmation", () => 0);
      expect(forA.variant).toBe(1);
      expect(forOther.variant).toBe(0);
    });
  });
});
