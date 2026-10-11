import type { TimeBlock } from "@/generated/prisma/client";
import { dateRangeSchema, timeBlockSchema, type DateRange, type TimeBlockInput } from "@/server/validation/agenda";
import { byId, isId, professionalExists, type TenantScope } from "../shared";

// Bloqueios avulsos da agenda de um profissional (D9), sem recorrência.

export interface TimeBlockRangeQuery extends DateRange {
  professionalId?: string;
}

export function createTimeBlocksRepository(scope: TenantScope) {
  const { tenantId, db } = scope;

  return {
    // Bloqueios que cruzam [startsAt, endsAt), inclusive os que começam antes da janela.
    listRange(query: TimeBlockRangeQuery): Promise<TimeBlock[]> {
      const { startsAt, endsAt } = dateRangeSchema.parse(query);
      if (query.professionalId !== undefined && !isId(query.professionalId)) return Promise.resolve([]);
      return db.timeBlock.findMany({
        where: {
          tenantId,
          ...(query.professionalId ? { professionalId: query.professionalId } : {}),
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      });
    },

    findById(id: string): Promise<TimeBlock | null> {
      return byId(id, () => db.timeBlock.findFirst({ where: { id, tenantId } }));
    },

    async create(professionalId: string, input: TimeBlockInput): Promise<TimeBlock | null> {
      const { startsAt, endsAt, reason } = timeBlockSchema.parse(input);
      if (!(await professionalExists(scope, professionalId))) return null;
      return db.timeBlock.create({
        data: { tenantId, professionalId, startsAt, endsAt, reason: reason ?? null },
      });
    },

    async delete(id: string): Promise<boolean> {
      if (!isId(id)) return false;
      const { count } = await db.timeBlock.deleteMany({ where: { id, tenantId } });
      return count > 0;
    },
  };
}
