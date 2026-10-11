import type { Professional, Service, TimeBlock, WorkingHours } from "@/generated/prisma/client";
import type { ManageState } from "@/server/agenda/public-booking";
import type { PublicSite } from "@/server/repositories/public-repository";
import type { AppointmentDetails } from "@/server/repositories/tenant-repository";

// Corpo das respostas da API: sem tenant_id (vem sempre da sessão) e horários no mesmo
// formato "HH:MM" da entrada.

export function professionalDto(professional: Professional) {
  return {
    id: professional.id,
    name: professional.name,
    archivedAt: professional.archivedAt,
    createdAt: professional.createdAt,
    updatedAt: professional.updatedAt,
  };
}

export function serviceDto(service: Service) {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
    archivedAt: service.archivedAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function workingHoursDto(interval: WorkingHours) {
  return {
    id: interval.id,
    professionalId: interval.professionalId,
    weekday: interval.weekday,
    start: minutesToTime(interval.startMinute),
    end: minutesToTime(interval.endMinute),
  };
}

// Agendamento sem o hash do token de gestão: o painel nunca precisa dele.
export function appointmentDto(appointment: AppointmentDetails) {
  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    canceledAt: appointment.canceledAt,
    professional: appointment.professional,
    service: appointment.service,
    customer: appointment.customer,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

export function timeBlockDto(block: TimeBlock) {
  return {
    id: block.id,
    professionalId: block.professionalId,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    createdAt: block.createdAt,
  };
}

// Site público (D1, D2): só campos públicos do negócio, sem tenant_id. Dos parâmetros da agenda,
// só o que a tela de agendar mostra ao cliente.
export function publicSiteDto(site: PublicSite) {
  const { business } = site;
  return {
    business: {
      slug: business.slug,
      name: business.name,
      description: business.description,
      address: business.address,
      phone: business.phone,
      timezone: business.timezone,
      booking: {
        minAdvanceMinutes: business.minAdvanceMinutes,
        maxWindowDays: business.maxWindowDays,
        cancelDeadlineMinutes: business.cancelDeadlineMinutes,
      },
    },
    services: site.services,
    professionals: site.professionals,
  };
}

// Agendamento visto pelo link de gestão (D6): sem id, sem hash e, do cliente, só o nome.
export function publicAppointmentDto(appointment: AppointmentDetails, state: ManageState) {
  return {
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    canceledAt: appointment.canceledAt,
    service: appointment.service,
    professional: appointment.professional,
    customer: { name: appointment.customer.name },
    manageableUntil: state.manageableUntil,
    canManage: state.canManage,
  };
}
