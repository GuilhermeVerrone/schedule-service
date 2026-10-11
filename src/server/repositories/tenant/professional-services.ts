import type { Service } from "@/generated/prisma/client";
import { isId, professionalExists, serviceExists, type TenantScope } from "../shared";

// Vínculo N:N profissional × serviço (D5). As FKs compostas (tenant_id, id) impedem,
// no banco, ligar registros de tenants diferentes.
export function createProfessionalServicesRepository(scope: TenantScope) {
  const { tenantId, db } = scope;

  return {
    async listServices(professionalId: string): Promise<Service[] | null> {
      if (!(await professionalExists(scope, professionalId))) return null;
      return db.service.findMany({
        where: { tenantId, professionals: { some: { professionalId, tenantId } } },
        orderBy: { name: "asc" },
      });
    },

    async link(professionalId: string, serviceId: string): Promise<boolean> {
      const [professional, service] = await Promise.all([
        professionalExists(scope, professionalId),
        serviceExists(scope, serviceId),
      ]);
      if (!professional || !service) return false;
      await db.professionalService.createMany({
        data: [{ tenantId, professionalId, serviceId }],
        skipDuplicates: true,
      });
      return true;
    },

    async unlink(professionalId: string, serviceId: string): Promise<boolean> {
      if (!isId(professionalId) || !isId(serviceId)) return false;
      const { count } = await db.professionalService.deleteMany({
        where: { tenantId, professionalId, serviceId },
      });
      return count > 0;
    },

    // Substitui todos os serviços do profissional. Falha inteira (false) se algum id não for do tenant.
    async setServices(professionalId: string, serviceIds: readonly string[]): Promise<boolean> {
      const uniqueIds = [...new Set(serviceIds)];
      if (!uniqueIds.every(isId)) return false;
      const [professional, owned] = await Promise.all([
        professionalExists(scope, professionalId),
        db.service.count({ where: { tenantId, id: { in: uniqueIds } } }),
      ]);
      if (!professional || owned !== uniqueIds.length) return false;
      await db.$transaction([
        db.professionalService.deleteMany({ where: { tenantId, professionalId } }),
        db.professionalService.createMany({
          data: uniqueIds.map((serviceId) => ({ tenantId, professionalId, serviceId })),
        }),
      ]);
      return true;
    },
  };
}
