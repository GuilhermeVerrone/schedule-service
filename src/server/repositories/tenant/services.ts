import type { Service } from "@/generated/prisma/client";
import { byId, type ListOptions, type TenantScope } from "../shared";

export interface ServiceInput {
  name: string;
  durationMinutes: number;
  priceCents: number;
}

export function createServicesRepository({ tenantId, db }: TenantScope) {
  return {
    list(options: ListOptions = {}): Promise<Service[]> {
      return db.service.findMany({
        where: { tenantId, ...(options.includeArchived ? {} : { archivedAt: null }) },
        orderBy: { name: "asc" },
      });
    },

    findById(id: string): Promise<Service | null> {
      return byId(id, () => db.service.findFirst({ where: { id, tenantId } }));
    },

    create(input: ServiceInput): Promise<Service> {
      return db.service.create({
        data: {
          name: input.name,
          durationMinutes: input.durationMinutes,
          priceCents: input.priceCents,
          tenantId,
        },
      });
    },

    update(id: string, input: Partial<ServiceInput>): Promise<Service | null> {
      return byId(id, () =>
        db.service.update({
          where: { id, tenantId },
          data: {
            name: input.name,
            durationMinutes: input.durationMinutes,
            priceCents: input.priceCents,
          },
        }),
      );
    },

    archive(id: string): Promise<Service | null> {
      return byId(id, () =>
        db.service.update({ where: { id, tenantId }, data: { archivedAt: new Date() } }),
      );
    },

    unarchive(id: string): Promise<Service | null> {
      return byId(id, () =>
        db.service.update({ where: { id, tenantId }, data: { archivedAt: null } }),
      );
    },
  };
}
