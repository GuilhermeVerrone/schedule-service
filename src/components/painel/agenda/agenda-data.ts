import { apiRequest, type ApiResult, type ProfessionalDto, type ServiceDto } from "@/components/painel/catalog/api-client";

// Dados da agenda do painel (guia 7d; D4, D9) lidos das rotas da Fase 4.

export type AppointmentStatus = "confirmed" | "canceled" | "completed";

export interface AppointmentDto {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  canceledAt: string | null;
  professional: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number; priceCents: number };
  customer: { id: string; name: string; phone: string };
}

export interface TimeBlockDto {
  id: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface SlotDto {
  startsAt: string;
  endsAt: string;
  professionalIds?: string[];
}

// O que a tela precisa de uma vez: fuso e grade do negócio, profissionais e serviços ativos e
// quem atende o quê (para o formulário oferecer só combinações que a API aceita).
export interface AgendaCatalog {
  timezone: string;
  slotStepMinutes: number;
  professionals: ProfessionalDto[];
  services: ServiceDto[];
  servicesByProfessional: Record<string, string[]>;
}

export async function loadCatalog(): Promise<ApiResult<AgendaCatalog>> {
  const [settings, professionals, services] = await Promise.all([
    apiRequest<{ settings: { timezone: string; slotStepMinutes: number } }>("GET", "/api/settings"),
    apiRequest<{ professionals: ProfessionalDto[] }>("GET", "/api/professionals"),
    apiRequest<{ services: ServiceDto[] }>("GET", "/api/services"),
  ]);
  if (!settings.ok) return settings;
  if (!professionals.ok) return professionals;
  if (!services.ok) return services;
  const links = await Promise.all(
    professionals.data.professionals.map((professional) =>
      apiRequest<{ services: ServiceDto[] }>("GET", `/api/professionals/${professional.id}/services`),
    ),
  );
  const servicesByProfessional: Record<string, string[]> = {};
  for (const [index, professional] of professionals.data.professionals.entries()) {
    const result = links[index];
    if (!result.ok) return result;
    servicesByProfessional[professional.id] = result.data.services.map((service) => service.id);
  }
  return {
    ok: true,
    data: {
      timezone: settings.data.settings.timezone,
      slotStepMinutes: settings.data.settings.slotStepMinutes,
      professionals: professionals.data.professionals,
      services: services.data.services,
      servicesByProfessional,
    },
  };
}

export interface AgendaRange {
  appointments: AppointmentDto[];
  timeBlocks: TimeBlockDto[];
}

export async function loadRange(from: string, to: string, professionalId: string | null): Promise<ApiResult<AgendaRange>> {
  const query = new URLSearchParams({ from, to });
  if (professionalId) query.set("professionalId", professionalId);
  const [appointments, timeBlocks] = await Promise.all([
    apiRequest<{ appointments: AppointmentDto[] }>("GET", `/api/appointments?${query}`),
    apiRequest<{ timeBlocks: TimeBlockDto[] }>("GET", `/api/time-blocks?${query}`),
  ]);
  if (!appointments.ok) return appointments;
  if (!timeBlocks.ok) return timeBlocks;
  return { ok: true, data: { appointments: appointments.data.appointments, timeBlocks: timeBlocks.data.timeBlocks } };
}

export async function loadSlots(serviceId: string, professionalId: string, date: string): Promise<ApiResult<SlotDto[]>> {
  const query = new URLSearchParams({ serviceId, professionalId, date });
  const result = await apiRequest<{ slots: SlotDto[] }>("GET", `/api/availability?${query}`);
  return result.ok ? { ok: true, data: result.data.slots } : result;
}

// Conflito de horário (409, D8) em linguagem de quem agenda, apontando a saída.
export function conflictMessage(code: string, message: string, professionalName?: string): string {
  const who = professionalName ?? "O profissional";
  if (code === "appointment_conflict") {
    return `Conflito de horário: ${who} já tem um agendamento nesse horário. Escolha outro horário livre.`;
  }
  if (code === "slot_unavailable") {
    return `Esse horário não está livre para ${professionalName ?? "esse profissional"}: fica fora do expediente, cai num bloqueio ou encosta em outro agendamento. Escolha outro horário livre.`;
  }
  return message;
}

export const isConflict = (code: string) => code === "appointment_conflict" || code === "slot_unavailable";

// "5511987654321" → "(11) 98765-4321".
export function formatPhone(phone: string): string {
  const local = phone.startsWith("55") ? phone.slice(2) : phone;
  const match = /^(\d{2})(\d{4,5})(\d{4})$/.exec(local);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confirmado",
  completed: "Concluído",
  canceled: "Cancelado",
};
