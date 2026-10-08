import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  Professional,
  Service,
  Tenant,
  WorkingHours,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  weeklyScheduleSchema,
  workingHoursIntervalSchema,
  type WorkingHoursInput,
} from "@/server/validation/working-hours";

// Único ponto de acesso aos dados de negócio (guia 6, D2). Só se constrói com um tenantId,
// e toda query embute esse tenantId no where/data. Registros de outro tenant se comportam
// como inexistentes (null/false), sem revelar que existem.

export class TenantScopeError extends Error {
  constructor() {
    super("Repositório exige um tenantId válido");
    this.name = "TenantScopeError";
  }
}

export class WorkingHoursOverlapError extends Error {
  constructor() {
    super("Há intervalos sobrepostos no mesmo dia");
    this.name = "WorkingHoursOverlapError";
  }
}

const idSchema = z.uuid();

const isId = (value: unknown): value is string => idSchema.safeParse(value).success;

export interface ListOptions {
  includeArchived?: boolean;
}

export interface ProfessionalInput {
  name: string;
}

export interface ServiceInput {
  name: string;
  durationMinutes: number;
  priceCents: number;
}

const OVERLAP_CONSTRAINT = "working_hours_no_overlap";

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// A exclusão no banco (EXCLUDE gist) cobre a corrida entre duas gravações simultâneas.
function isOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : "";
  return error.message.includes(OVERLAP_CONSTRAINT) || meta.includes(OVERLAP_CONSTRAINT);
}

async function orNull<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export function createTenantRepository(tenantId: string, db: PrismaClient = prisma) {
  if (!isId(tenantId)) throw new TenantScopeError();

  const professionalExists = async (id: string): Promise<boolean> =>
    isId(id) && (await db.professional.count({ where: { id, tenantId } })) > 0;

  const serviceExists = async (id: string): Promise<boolean> =>
    isId(id) && (await db.service.count({ where: { id, tenantId } })) > 0;

  // IDs malformados se comportam como inexistentes, sem chegar ao banco.
  const byId = <T>(id: string, run: () => Promise<T>): Promise<T | null> =>
    isId(id) ? orNull(run()) : Promise.resolve(null);

  const tenant = {
    get(): Promise<Tenant | null> {
      return db.tenant.findUnique({ where: { id: tenantId } });
    },
  };

  const professionals = {
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

  const services = {
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

  // Vínculo N:N profissional × serviço (D5). As FKs compostas (tenant_id, id) impedem,
  // no banco, ligar registros de tenants diferentes.
  const professionalServices = {
    async listServices(professionalId: string): Promise<Service[] | null> {
      if (!(await professionalExists(professionalId))) return null;
      return db.service.findMany({
        where: { tenantId, professionals: { some: { professionalId, tenantId } } },
        orderBy: { name: "asc" },
      });
    },

    async link(professionalId: string, serviceId: string): Promise<boolean> {
      const [professional, service] = await Promise.all([
        professionalExists(professionalId),
        serviceExists(serviceId),
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
        professionalExists(professionalId),
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

  // Horários apagados de verdade (D6). Entrada validada com Zod antes de tocar no banco.
  const workingHours = {
    async list(professionalId: string): Promise<WorkingHours[] | null> {
      if (!(await professionalExists(professionalId))) return null;
      return db.workingHours.findMany({
        where: { tenantId, professionalId },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      });
    },

    async create(professionalId: string, input: WorkingHoursInput): Promise<WorkingHours | null> {
      const interval = workingHoursIntervalSchema.parse(input);
      if (!(await professionalExists(professionalId))) return null;
      try {
        return await db.workingHours.create({ data: { ...interval, tenantId, professionalId } });
      } catch (error) {
        if (isOverlapViolation(error)) throw new WorkingHoursOverlapError();
        throw error;
      }
    },

    async update(id: string, input: WorkingHoursInput): Promise<WorkingHours | null> {
      const interval = workingHoursIntervalSchema.parse(input);
      try {
        return await byId(id, () =>
          db.workingHours.update({ where: { id, tenantId }, data: interval }),
        );
      } catch (error) {
        if (isOverlapViolation(error)) throw new WorkingHoursOverlapError();
        throw error;
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
      if (!(await professionalExists(professionalId))) return null;
      try {
        await db.$transaction([
          db.workingHours.deleteMany({ where: { tenantId, professionalId } }),
          db.workingHours.createMany({
            data: intervals.map((interval) => ({ ...interval, tenantId, professionalId })),
          }),
        ]);
      } catch (error) {
        if (isOverlapViolation(error)) throw new WorkingHoursOverlapError();
        throw error;
      }
      return db.workingHours.findMany({
        where: { tenantId, professionalId },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      });
    },
  };

  return { tenantId, tenant, professionals, services, professionalServices, workingHours };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
