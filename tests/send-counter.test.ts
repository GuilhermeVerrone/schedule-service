import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient, Tenant } from "@/generated/prisma/client";
import { createPrismaClient, prisma } from "@/lib/db";
import { dailyLimit, evaluateSendPolicy, tenantDay } from "@/server/outbound/send-policy";
import { createTenantRepository, type TenantRepository } from "@/server/repositories/tenant-repository";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fase 4: contador diário atômico no SQL e primeira conexão (D3, D9, D10, D14), na branch test.
// Dois consumos simultâneos (de dois clients, como dois workers) nunca passam do teto.

const DAY = "2026-10-11";
let tenantA: Tenant;
let tenantB: Tenant;
let repoA: TenantRepository;
let repoB: TenantRepository;
let workerDb: PrismaClient;

const session = () => `sessao-${randomUUID()}`;

async function setCounter(tenantId: string, sentCount: number, countDate: string | null, manual: number | null = null) {
  await prisma.whatsAppConnection.update({
    where: { tenantId },
    data: { dailySentCount: sentCount, dailyCountDate: countDate ? new Date(`${countDate}T00:00:00Z`) : null, dailySendLimit: manual },
  });
}

beforeAll(async () => {
  tenantA = await createTestTenant("contador-a");
  tenantB = await createTestTenant("contador-b");
  await prisma.tenant.update({ where: { id: tenantB.id }, data: { timezone: "Asia/Tokyo" } });
  repoA = createTenantRepository(tenantA.id);
  repoB = createTenantRepository(tenantB.id);
  workerDb = createPrismaClient(process.env.DATABASE_URL!);
  await repoA.whatsappConnection.save({ sessionId: session(), status: "connected" });
  await repoB.whatsappConnection.save({ sessionId: session(), status: "connected" });
});

afterAll(async () => {
  await deleteTestTenants(tenantA, tenantB);
  await workerDb.$disconnect();
});

describe("contador diário atômico (sendCounter)", () => {
  beforeEach(async () => {
    await setCounter(tenantA.id, 0, null);
    await setCounter(tenantB.id, 0, null);
  });

  it("estado: fuso do tenant, primeira conexão, teto manual e contador", async () => {
    await setCounter(tenantA.id, 3, DAY, 50);
    const state = await repoA.sendCounter.getState();
    expect(state).toMatchObject({ timezone: "America/Sao_Paulo", manualLimit: 50, sentCount: 3, countDate: DAY });
    expect(state?.firstConnectedAt).toBeInstanceOf(Date);
    expect((await repoB.sendCounter.getState())?.timezone).toBe("Asia/Tokyo");
  });

  it("consome até o teto e recusa a vaga seguinte", async () => {
    const counts = [];
    for (let i = 0; i < 4; i++) counts.push(await repoA.sendCounter.consume(DAY, 3));
    expect(counts).toEqual([1, 2, 3, null]);
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(3);
  });

  it("dois consumos simultâneos com uma vaga só: exatamente um consome", async () => {
    await setCounter(tenantA.id, 19, DAY);
    const repoWorker = createTenantRepository(tenantA.id, workerDb);
    const results = await Promise.all([repoA.sendCounter.consume(DAY, 20), repoWorker.sendCounter.consume(DAY, 20)]);
    expect(results.filter((r) => r !== null)).toEqual([20]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(20);
  });

  it("30 consumos simultâneos de dois clients com teto 20: 20 vagas, contagens 1..20 sem repetir", async () => {
    const repoWorker = createTenantRepository(tenantA.id, workerDb);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? repoA : repoWorker).sendCounter.consume(DAY, 20)),
    );
    const granted = results.filter((r): r is number => r !== null).sort((a, b) => a - b);
    expect(granted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(20);
  });

  it("teto manual menor que o limite da política é respeitado no SQL", async () => {
    await setCounter(tenantA.id, 4, DAY, 5);
    expect(await repoA.sendCounter.consume(DAY, 200)).toBe(5);
    expect(await repoA.sendCounter.consume(DAY, 200)).toBeNull();
  });

  it("virada do dia: contador de ontem recomeça em 1", async () => {
    await setCounter(tenantA.id, 200, "2026-10-10");
    expect(await repoA.sendCounter.consume(DAY, 200)).toBe(1);
    expect(await repoA.sendCounter.getState()).toMatchObject({ sentCount: 1, countDate: DAY });
  });

  it("dia mais antigo que o gravado (relógio atrasado) não zera o contador", async () => {
    await setCounter(tenantA.id, 200, "2026-10-12");
    expect(await repoA.sendCounter.consume(DAY, 200)).toBeNull();
    expect(await repoA.sendCounter.getState()).toMatchObject({ sentCount: 200, countDate: "2026-10-12" });
  });

  it("release devolve a vaga do mesmo dia; de outro dia ou zerado, não", async () => {
    await setCounter(tenantA.id, 2, DAY);
    expect(await repoA.sendCounter.release(DAY)).toBe(true);
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(1);
    expect(await repoA.sendCounter.release("2026-10-10")).toBe(false);
    await setCounter(tenantA.id, 0, DAY);
    expect(await repoA.sendCounter.release(DAY)).toBe(false);
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(0);
  });

  it("isolamento: consumir no A não mexe no B", async () => {
    await repoA.sendCounter.consume(DAY, 200);
    await repoA.sendCounter.consume(DAY, 200);
    expect((await repoB.sendCounter.getState())?.sentCount).toBe(0);
    expect((await repoA.sendCounter.getState())?.sentCount).toBe(2);
  });

  it("sem conexão: estado null e consumo null", async () => {
    const tenant = await createTestTenant("contador-sem");
    try {
      const repo = createTenantRepository(tenant.id);
      expect(await repo.sendCounter.getState()).toBeNull();
      expect(await repo.sendCounter.consume(DAY, 200)).toBeNull();
      expect(await repo.sendCounter.release(DAY)).toBe(false);
    } finally {
      await deleteTestTenants(tenant);
    }
  });

  it("dia ou limite inválidos são recusados antes do banco", async () => {
    await expect(repoA.sendCounter.consume("11/10/2026", 200)).rejects.toThrow(RangeError);
    await expect(repoA.sendCounter.consume(DAY, 0)).rejects.toThrow(RangeError);
    await expect(repoA.sendCounter.consume(DAY, 1.5)).rejects.toThrow(RangeError);
    await expect(repoA.sendCounter.release("ontem")).rejects.toThrow(RangeError);
  });

  it("política + contador no fuso de Tóquio: o dia da política é o dia do contador", async () => {
    const now = new Date("2026-10-11T15:30:00.000Z"); // 00:30 de 12/10 em Tóquio
    await setCounter(tenantB.id, 200, DAY);
    const state = (await repoB.sendCounter.getState())!;
    const decision = evaluateSendPolicy({
      messageType: "appointment_confirmation",
      dueAt: now,
      now,
      timezone: state.timezone,
      firstConnectedAt: new Date("2026-09-01T00:00:00.000Z"),
      manualLimit: state.manualLimit,
      counter: { sentCount: state.sentCount, countDate: state.countDate },
    });
    expect(decision).toEqual({ action: "send", day: "2026-10-12", limit: 200 });
    if (decision.action !== "send") return;
    expect(await repoB.sendCounter.consume(decision.day, decision.limit)).toBe(1);
    expect(tenantDay(now, "America/Sao_Paulo")).toBe(DAY);
  });
});

describe("primeira conexão (início do aquecimento)", () => {
  it("connect grava a data; desconectar e reconectar (nova sessão) não altera", async () => {
    const tenant = await createTestTenant("primeira");
    try {
      const repo = createTenantRepository(tenant.id);
      await repo.whatsappConnection.save({ sessionId: session(), status: "qr_pending" });
      expect((await repo.whatsappConnection.get())?.firstConnectedAt).toBeNull();

      const first = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
      await repo.whatsappConnection.setStatus("connected", first);
      const recorded = (await repo.whatsappConnection.get())?.firstConnectedAt;
      expect(recorded).toEqual(first);

      await repo.whatsappConnection.setStatus("disconnected");
      await repo.whatsappConnection.save({ sessionId: session(), status: "qr_pending" });
      await repo.whatsappConnection.save({ sessionId: session(), status: "connected" });
      await repo.whatsappConnection.setStatus("connected");
      const after = await repo.sendCounter.getState();
      expect(after?.firstConnectedAt).toEqual(first);

      // Reconectou, mas segue no dia 10 da curva (160), não volta ao dia 1 (20).
      const limit = dailyLimit({
        firstConnectedAt: after!.firstConnectedAt,
        manualLimit: null,
        now: new Date(first.getTime() + 9 * 24 * 60 * 60 * 1000),
        timezone: after!.timezone,
      });
      expect(limit).toBe(160);
    } finally {
      await deleteTestTenants(tenant);
    }
  });

  it("criar já connected grava a data na criação", async () => {
    const tenant = await createTestTenant("primeira-direta");
    try {
      const repo = createTenantRepository(tenant.id);
      const before = Date.now();
      await repo.whatsappConnection.save({ sessionId: session(), status: "connected" });
      const at = (await repo.whatsappConnection.get())?.firstConnectedAt;
      expect(at).toBeInstanceOf(Date);
      expect(at!.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    } finally {
      await deleteTestTenants(tenant);
    }
  });

  it("banned_suspected ou disconnected sem nunca conectar não grava a data", async () => {
    const tenant = await createTestTenant("primeira-nunca");
    try {
      const repo = createTenantRepository(tenant.id);
      await repo.whatsappConnection.save({ sessionId: session(), status: "disconnected" });
      await repo.whatsappConnection.setStatus("banned_suspected");
      expect((await repo.whatsappConnection.get())?.firstConnectedAt).toBeNull();
    } finally {
      await deleteTestTenants(tenant);
    }
  });
});
