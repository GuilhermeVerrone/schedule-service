import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isId, TenantScopeError, type TenantScope } from "./shared";
import { createAppointmentsRepository } from "./tenant/appointments";
import { createCustomersRepository } from "./tenant/customers";
import { createProfessionalServicesRepository } from "./tenant/professional-services";
import { createProfessionalsRepository } from "./tenant/professionals";
import { createServicesRepository } from "./tenant/services";
import { createSettingsRepository, createTenantInfoRepository } from "./tenant/settings";
import { createTimeBlocksRepository } from "./tenant/time-blocks";
import { createWorkingHoursRepository } from "./tenant/working-hours";

// Único ponto de acesso aos dados de negócio (guia 6, D2). Só se constrói com um tenantId,
// e toda query embute esse tenantId no where/data. Registros de outro tenant se comportam
// como inexistentes (null/false), sem revelar que existem. Cada domínio fica em ./tenant/.

export { TenantScopeError, type ListOptions } from "./shared";
export type { ProfessionalInput } from "./tenant/professionals";
export type { ServiceInput } from "./tenant/services";
export { WorkingHoursOverlapError } from "./tenant/working-hours";
export type { AgendaSettings } from "./tenant/settings";
export type { ConsentInput } from "./tenant/customers";
export {
  AppointmentConflictError,
  AppointmentStatusError,
  type AppointmentDetails,
  type AppointmentInput,
  type AppointmentRangeQuery,
  type RescheduleInput,
} from "./tenant/appointments";
export type { TimeBlockRangeQuery } from "./tenant/time-blocks";

export function createTenantRepository(tenantId: string, db: PrismaClient = prisma) {
  if (!isId(tenantId)) throw new TenantScopeError();
  const scope: TenantScope = { tenantId, db };

  return {
    tenantId,
    tenant: createTenantInfoRepository(scope),
    settings: createSettingsRepository(scope),
    professionals: createProfessionalsRepository(scope),
    services: createServicesRepository(scope),
    professionalServices: createProfessionalServicesRepository(scope),
    workingHours: createWorkingHoursRepository(scope),
    customers: createCustomersRepository(scope),
    appointments: createAppointmentsRepository(scope),
    timeBlocks: createTimeBlocksRepository(scope),
  };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
