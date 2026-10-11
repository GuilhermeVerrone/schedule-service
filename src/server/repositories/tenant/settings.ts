import type { Tenant } from "@/generated/prisma/client";
import { agendaSettingsSchema, type AgendaSettingsInput } from "@/server/validation/agenda";
import type { TenantScope } from "../shared";

// Dados do negócio (D2) e parâmetros da agenda (D3) do próprio tenant.

const settingsFields = {
  name: true,
  slug: true,
  timezone: true,
  description: true,
  address: true,
  phone: true,
  slotStepMinutes: true,
  bufferMinutes: true,
  minAdvanceMinutes: true,
  maxWindowDays: true,
  cancelDeadlineMinutes: true,
} as const;

export type AgendaSettings = Pick<Tenant, keyof typeof settingsFields>;

export function createTenantInfoRepository({ tenantId, db }: TenantScope) {
  return {
    get(): Promise<Tenant | null> {
      return db.tenant.findUnique({ where: { id: tenantId } });
    },
  };
}

export function createSettingsRepository({ tenantId, db }: TenantScope) {
  return {
    get(): Promise<AgendaSettings | null> {
      return db.tenant.findUnique({ where: { id: tenantId }, select: settingsFields });
    },

    // Nome, slug e fuso não mudam por aqui: só os campos do schema passam.
    async update(input: AgendaSettingsInput): Promise<AgendaSettings | null> {
      const data = agendaSettingsSchema.parse(input);
      const { count } = await db.tenant.updateMany({ where: { id: tenantId }, data });
      if (count === 0) return null;
      return db.tenant.findUnique({ where: { id: tenantId }, select: settingsFields });
    },
  };
}
