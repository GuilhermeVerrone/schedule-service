import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isId, TenantScopeError, type TenantScope } from "./shared";
import { createAppointmentsRepository } from "./tenant/appointments";
import { createContactsRepository } from "./tenant/contacts";
import { createEligibilityRepository } from "./tenant/eligibility";
import { createConversationsRepository } from "./tenant/conversations";
import { createMessagesRepository } from "./tenant/messages";
import { createProfessionalServicesRepository } from "./tenant/professional-services";
import { createProfessionalsRepository } from "./tenant/professionals";
import { createServicesRepository } from "./tenant/services";
import { createSettingsRepository, createTenantInfoRepository } from "./tenant/settings";
import { createTimeBlocksRepository } from "./tenant/time-blocks";
import { createWhatsAppConnectionRepository } from "./tenant/whatsapp-connection";
import { createWorkingHoursRepository } from "./tenant/working-hours";

// Único ponto de acesso aos dados de negócio (guia 6, D2). Só se constrói com um tenantId,
// e toda query embute esse tenantId no where/data. Registros de outro tenant se comportam
// como inexistentes (null/false), sem revelar que existem. Cada domínio fica em ./tenant/.

export { TenantScopeError, type ListOptions } from "./shared";
export type { ProfessionalInput } from "./tenant/professionals";
export type { ServiceInput } from "./tenant/services";
export { WorkingHoursOverlapError } from "./tenant/working-hours";
export type { AgendaSettings } from "./tenant/settings";
export type { ConsentInput } from "./tenant/contacts";
export type { EligibilityFacts } from "./tenant/eligibility";
export {
  AppointmentConflictError,
  AppointmentStatusError,
  type AppointmentDetails,
  type AppointmentInput,
  type AppointmentRangeQuery,
  type RescheduleInput,
} from "./tenant/appointments";
export type { TimeBlockRangeQuery } from "./tenant/time-blocks";
export { SessionIdTakenError } from "./tenant/whatsapp-connection";
export type {
  ConversationContact,
  ConversationDetails,
  ConversationSummary,
  LastMessage,
  Page,
} from "./tenant/conversations";
export type { MessageView } from "./tenant/messages";

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
    contacts: createContactsRepository(scope),
    eligibility: createEligibilityRepository(scope),
    appointments: createAppointmentsRepository(scope),
    timeBlocks: createTimeBlocksRepository(scope),
    whatsappConnection: createWhatsAppConnectionRepository(scope),
    conversations: createConversationsRepository(scope),
    messages: createMessagesRepository(scope),
  };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
