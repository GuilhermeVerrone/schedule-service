import type { Professional } from "@/generated/prisma/client";
import { byId, type ListOptions, type TenantScope } from "../shared";

export interface ProfessionalInput {
  name: string;
}

export function createProfessionalsRepository({ tenantId, db }: TenantScope) {
  return {
    list(options: ListOptions = {}): Promise<Professional[]> {
      return db.professional.findMany({
        where: { tenantId, ...(options.includeArchived ? {} : { archivedAt: null }) },
        orderBy: { name: "asc" },
      });
    },

    findById(id: string): Promise<Professional | null> {
      return byId(id, () => db.professional.findFirst({ where: { id, tenantId } }));
    },

    create(input: ProfessionalInput): Promise<Professional> {
      return db.professional.create({ data: { name: input.name, tenantId } });
    },

    update(id: string, input: Partial<ProfessionalInput>): Promise<Professional | null> {
      return byId(id, () =>
        db.professional.update({ where: { id, tenantId }, data: { name: input.name } }),
      );
    },

    archive(id: string): Promise<Professional | null> {
      return byId(id, () =>
        db.professional.update({ where: { id, tenantId }, data: { archivedAt: new Date() } }),
      );
    },

    unarchive(id: string): Promise<Professional | null> {
      return byId(id, () =>
        db.professional.update({ where: { id, tenantId }, data: { archivedAt: null } }),
      );
    },
  };
}
