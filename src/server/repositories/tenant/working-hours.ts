import type { WorkingHours } from "@/generated/prisma/client";
import {
  weeklyScheduleSchema,
  workingHoursIntervalSchema,
  type WorkingHoursInput,
} from "@/server/validation/working-hours";
import { byId, isConstraintViolation, isId, professionalExists, type TenantScope } from "../shared";

export class WorkingHoursOverlapError extends Error {
  constructor() {
    super("Há intervalos sobrepostos no mesmo dia");
    this.name = "WorkingHoursOverlapError";
  }
}

// A exclusão no banco (EXCLUDE gist) cobre a corrida entre duas gravações simultâneas.
const OVERLAP_CONSTRAINT = "working_hours_no_overlap";

function rethrowOverlap(error: unknown): never {
  if (isConstraintViolation(error, OVERLAP_CONSTRAINT)) throw new WorkingHoursOverlapError();
  throw error;
}

// Horários apagados de verdade (D6). Entrada validada com Zod antes de tocar no banco.
export function createWorkingHoursRepository(scope: TenantScope) {
  const { tenantId, db } = scope;

  const listOf = (professionalId: string) =>
    db.workingHours.findMany({
      where: { tenantId, professionalId },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    });

  return {
    async list(professionalId: string): Promise<WorkingHours[] | null> {
      if (!(await professionalExists(scope, professionalId))) return null;
      return listOf(professionalId);
    },

    async create(professionalId: string, input: WorkingHoursInput): Promise<WorkingHours | null> {
      const interval = workingHoursIntervalSchema.parse(input);
      if (!(await professionalExists(scope, professionalId))) return null;
      try {
        return await db.workingHours.create({ data: { ...interval, tenantId, professionalId } });
      } catch (error) {
        rethrowOverlap(error);
      }
    },

    async update(id: string, input: WorkingHoursInput): Promise<WorkingHours | null> {
      const interval = workingHoursIntervalSchema.parse(input);
      try {
        return await byId(id, () =>
          db.workingHours.update({ where: { id, tenantId }, data: interval }),
        );
      } catch (error) {
        rethrowOverlap(error);
      }
    },

    async delete(id: string): Promise<boolean> {
      if (!isId(id)) return false;
      const { count } = await db.workingHours.deleteMany({ where: { id, tenantId } });
      return count > 0;
    },

    // Substitui a grade semanal inteira do profissional numa transação.
    async replaceAll(
      professionalId: string,
      inputs: readonly WorkingHoursInput[],
    ): Promise<WorkingHours[] | null> {
      const intervals = weeklyScheduleSchema.parse(inputs);
      if (!(await professionalExists(scope, professionalId))) return null;
      try {
        await db.$transaction([
          db.workingHours.deleteMany({ where: { tenantId, professionalId } }),
          db.workingHours.createMany({
            data: intervals.map((interval) => ({ ...interval, tenantId, professionalId })),
          }),
        ]);
      } catch (error) {
        rethrowOverlap(error);
      }
      return listOf(professionalId);
    },
  };
}
