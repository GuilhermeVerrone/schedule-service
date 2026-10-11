import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db";
import { createDefaultTemplates } from "./tenant/message-templates";

// Templates padrão para os tenants criados antes da Fase 5 (D5). Idempotente: só cria o que falta,
// nunca sobrescreve um template já editado pelo dono. Percorre todos os tenants, por isso fica fora
// do repositório por tenant; cada criação embute o tenantId daquele tenant.

export interface BackfillResult {
  tenants: number;
  created: number;
}

// Tenant apagado entre a listagem e a criação (FK): não há mais o que preencher.
const isTenantGone = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

export async function backfillDefaultTemplates(db: PrismaClient): Promise<BackfillResult> {
  const tenants = await db.tenant.findMany({ select: { id: true } });
  let created = 0;
  for (const { id } of tenants) {
    try {
      created += await createDefaultTemplates(db, id);
    } catch (error) {
      if (!isTenantGone(error)) throw error;
    }
  }
  return { tenants: tenants.length, created };
}

export async function backfillDefaultTemplatesAt(connectionString: string): Promise<BackfillResult> {
  const db = createPrismaClient(connectionString);
  try {
    return await backfillDefaultTemplates(db);
  } finally {
    await db.$disconnect();
  }
}
