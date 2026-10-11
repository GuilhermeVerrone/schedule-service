import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Professional, Service, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createPublicRepository, isPublicSlug } from "@/server/repositories/public-repository";
import { createTenantRepository } from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Repositório público (guia 6, D1): resolve o tenant pelo slug e devolve só campos públicos,
// sem dado de outro tenant nem arquivado, e só serviços e profissionais vinculados entre si.

const publicRepo = createPublicRepository();

let tenantA: Tenant;
let tenantB: Tenant;
let empty: Tenant;

// Tenant A: o que deve aparecer.
let ana: Professional;
let bruno: Professional;
let corte: Service;
let barba: Service;
// Tenant A: o que não deve aparecer.
let arquivado: Professional;
let semVinculo: Professional;
let servicoArquivado: Service;
let soComArquivado: Service;
let servicoSemVinculo: Service;
// Tenant B.
let profB: Professional;
let serviceB: Service;

beforeAll(async () => {
  [tenantA, tenantB, empty] = await Promise.all([
    createTestTenant("pub-a"),
    createTestTenant("pub-b"),
    createTestTenant("pub-vazio"),
  ]);
  const repoA = createTenantRepository(tenantA.id);
  const repoB = createTenantRepository(tenantB.id);
  await repoA.settings.update({ description: "Barbearia", address: "Rua A, 1", phone: "11 3333-4444" });

  [ana, bruno, arquivado, semVinculo] = await Promise.all([
    repoA.professionals.create({ name: "Ana" }),
    repoA.professionals.create({ name: "Bruno" }),
    repoA.professionals.create({ name: "Arquivado" }),
    repoA.professionals.create({ name: "Sem vínculo" }),
  ]);
  [corte, barba, servicoArquivado, soComArquivado, servicoSemVinculo] = await Promise.all([
    repoA.services.create({ name: "Corte", durationMinutes: 30, priceCents: 5000 }),
    repoA.services.create({ name: "Barba", durationMinutes: 20, priceCents: 3000 }),
    repoA.services.create({ name: "Arquivado", durationMinutes: 30, priceCents: 1000 }),
    repoA.services.create({ name: "Só com arquivado", durationMinutes: 30, priceCents: 1000 }),
    repoA.services.create({ name: "Sem vínculo", durationMinutes: 30, priceCents: 1000 }),
  ]);
  await repoA.professionalServices.setServices(ana.id, [corte.id, barba.id, servicoArquivado.id]);
  await repoA.professionalServices.setServices(bruno.id, [corte.id]);
  await repoA.professionalServices.setServices(arquivado.id, [soComArquivado.id, corte.id]);
  await repoA.professionals.archive(arquivado.id);
  await repoA.services.archive(servicoArquivado.id);

  [profB, serviceB] = await Promise.all([
    repoB.professionals.create({ name: "Bia (B)" }),
    repoB.services.create({ name: "Escova (B)", durationMinutes: 45, priceCents: 7000 }),
  ]);
  await repoB.professionalServices.link(profB.id, serviceB.id);
});

afterAll(async () => {
  await deleteTestTenants(tenantA, tenantB, empty);
  await prisma.$disconnect();
});

describe("resolução do tenant pelo slug", () => {
  it("devolve o negócio só com campos públicos e o tenantId interno", async () => {
    const resolved = await publicRepo.resolveTenant(tenantA.slug);
    expect(resolved?.tenantId).toBe(tenantA.id);
    expect(Object.keys(resolved!.business).sort()).toEqual(
      [
        "address",
        "bufferMinutes",
        "cancelDeadlineMinutes",
        "description",
        "maxWindowDays",
        "minAdvanceMinutes",
        "name",
        "phone",
        "slotStepMinutes",
        "slug",
        "timezone",
      ].sort(),
    );
    expect(resolved!.business).toMatchObject({
      slug: tenantA.slug,
      name: tenantA.name,
      description: "Barbearia",
      address: "Rua A, 1",
      phone: "11 3333-4444",
      timezone: "America/Sao_Paulo",
    });
  });

  it("slug inexistente, reservado ou malformado devolve null", async () => {
    for (const slug of ["nao-existe-123", "login", "painel", "api", "", "Teste", "a--b", "-a", "x' or '1'='1", "a/b", "x".repeat(49)]) {
      expect(await publicRepo.resolveTenant(slug)).toBeNull();
      expect(await publicRepo.getSite(slug)).toBeNull();
    }
    expect(isPublicSlug(tenantA.slug)).toBe(true);
  });
});

describe("site público", () => {
  it("só serviços e profissionais ativos e vinculados do próprio tenant", async () => {
    const site = (await publicRepo.getSite(tenantA.slug))!;
    expect(site.services).toEqual([
      { id: barba.id, name: "Barba", durationMinutes: 20, priceCents: 3000, professionalIds: [ana.id] },
      {
        id: corte.id,
        name: "Corte",
        durationMinutes: 30,
        priceCents: 5000,
        professionalIds: [ana.id, bruno.id].sort(),
      },
    ]);
    expect(site.professionals).toEqual([
      { id: ana.id, name: "Ana", serviceIds: [corte.id, barba.id].sort() },
      { id: bruno.id, name: "Bruno", serviceIds: [corte.id] },
    ]);
  });

  it("nunca devolve arquivado, sem vínculo ou dado do outro tenant", async () => {
    const site = (await publicRepo.getSite(tenantA.slug))!;
    const json = JSON.stringify(site);
    for (const hidden of [
      arquivado.id,
      semVinculo.id,
      servicoArquivado.id,
      soComArquivado.id,
      servicoSemVinculo.id,
      profB.id,
      serviceB.id,
      tenantB.id,
      tenantB.slug,
    ]) {
      expect(json).not.toContain(hidden);
    }
    // E o B só vê o que é dele.
    const siteB = (await publicRepo.getSite(tenantB.slug))!;
    expect(siteB.tenantId).toBe(tenantB.id);
    expect(siteB.services.map((s) => s.id)).toEqual([serviceB.id]);
    expect(siteB.professionals.map((p) => p.id)).toEqual([profB.id]);
  });

  it("arquivar depois tira do site na hora; desarquivar devolve", async () => {
    const repoA = createTenantRepository(tenantA.id);
    await repoA.professionals.archive(bruno.id);
    let site = (await publicRepo.getSite(tenantA.slug))!;
    expect(site.professionals.map((p) => p.id)).toEqual([ana.id]);
    expect(site.services.find((s) => s.id === corte.id)?.professionalIds).toEqual([ana.id]);

    await repoA.services.archive(barba.id);
    site = (await publicRepo.getSite(tenantA.slug))!;
    expect(site.services.map((s) => s.id)).toEqual([corte.id]);
    expect(site.professionals[0].serviceIds).toEqual([corte.id]);

    await repoA.professionals.unarchive(bruno.id);
    await repoA.services.unarchive(barba.id);
    site = (await publicRepo.getSite(tenantA.slug))!;
    expect(site.professionals.map((p) => p.id)).toEqual([ana.id, bruno.id]);
  });

  it("negócio sem serviços nem profissionais: listas vazias, não null", async () => {
    const site = await publicRepo.getSite(empty.slug);
    expect(site).toMatchObject({ tenantId: empty.id, services: [], professionals: [] });
  });
});
