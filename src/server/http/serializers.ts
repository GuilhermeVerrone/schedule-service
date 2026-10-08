import type { Professional, Service, WorkingHours } from "@/generated/prisma/client";

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
