import { randomUUID } from "node:crypto";
import type { Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Fixtures criam e apagam tenants direto pelo Prisma: cadastro é da Fase 3 (auth).
// Apagar o tenant leva junto, em cascata, todos os dados dele.

export async function createTestTenant(label: string): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  return prisma.tenant.create({ data: { name: `Teste ${label}`, slug: `teste-${label}-${suffix}` } });
}

export async function deleteTestTenants(...tenants: (Tenant | undefined)[]): Promise<void> {
  const ids = tenants.filter((t): t is Tenant => t !== undefined).map((t) => t.id);
  if (ids.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}
