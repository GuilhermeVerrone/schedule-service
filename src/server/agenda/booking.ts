import { DateTime } from "luxon";
import type { Professional, Service } from "@/generated/prisma/client";
import {
  getAnyProfessionalDaySlots,
  isSlotAvailable,
  type AgendaParams,
  type AnyProfessionalSlot,
  type AvailabilityContext,
  type ProfessionalSchedule,
} from "@/server/agenda/availability";
import {
  AppointmentStatusError,
  type AgendaSettings,
  type AppointmentDetails,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";
import { AGENDA_LIMITS } from "@/server/validation/agenda";

// Regras de agendamento do painel (guia 6, 7d; D3, D4, D9) sobre o repositório do tenant. O banco
// garante posse e não sobreposição; aqui ficam vínculo, arquivado e horário livre (trabalho, grade,
// buffer, bloqueios). null = profissional, serviço ou agendamento fora do tenant (a rota dá 404).
//
// O dono agenda pelo painel sem a antecedência mínima e a janela máxima, que valem para o cliente
// no site: pode encaixar alguém daqui a 10 minutos ou marcar o retorno de daqui a 6 meses. O
// horário ainda precisa estar livre na grade, dentro do expediente e com o buffer.

// O horário pedido não é um dos horários livres (fora do expediente, da grade, bloqueado, no buffer).
export class SlotUnavailableError extends Error {
  constructor() {
    super("Horário indisponível");
    this.name = "SlotUnavailableError";
  }
}

// Profissional ou serviço arquivado, ou profissional que não atende o serviço.
export class NotBookableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotBookableError";
  }
}

export const MINUTE_MS = 60_000;

interface Bookable {
  professional: Professional;
  service: Service;
}

// Quem agenda: o dono no painel (sem antecedência nem janela) ou o cliente no site (com as duas).
export type Audience = "owner" | "customer";

export function agendaParams(settings: AgendaSettings): AgendaParams {
  return {
    slotStepMinutes: settings.slotStepMinutes,
    bufferMinutes: settings.bufferMinutes,
    minAdvanceMinutes: settings.minAdvanceMinutes,
    maxWindowDays: settings.maxWindowDays,
  };
}

// Parâmetros do dono: sem antecedência (só não volta ao passado) e com a janela no teto permitido.
function ownerParams(settings: AgendaSettings): AgendaParams {
  return { ...agendaParams(settings), minAdvanceMinutes: 0, maxWindowDays: AGENDA_LIMITS.maxWindowDays.max };
}

function paramsFor(settings: AgendaSettings, audience: Audience): AgendaParams {
  return audience === "owner" ? ownerParams(settings) : agendaParams(settings);
}

export async function loadSettings(repo: TenantRepository): Promise<AgendaSettings> {
  const settings = await repo.settings.get();
  if (!settings) throw new Error("Tenant da sessão não encontrado");
  return settings;
}

export async function loadBookable(
  repo: TenantRepository,
  professionalId: string,
  serviceId: string,
): Promise<Bookable | null> {
  const [professional, service] = await Promise.all([
    repo.professionals.findById(professionalId),
    repo.services.findById(serviceId),
  ]);
  if (!professional || !service) return null;
  if (professional.archivedAt) throw new NotBookableError("Esse profissional está arquivado.");
  if (service.archivedAt) throw new NotBookableError("Esse serviço está arquivado.");
  const offered = (await repo.professionalServices.listServices(professionalId)) ?? [];
  if (!offered.some((item) => item.id === serviceId)) {
    throw new NotBookableError("Esse profissional não atende esse serviço.");
  }
  return { professional, service };
}

// Trabalho, bloqueios e agendamentos confirmed do dia local, com um dia de folga para cada lado
// (serviços que atravessam a meia-noite). `excludeId` tira o próprio agendamento ao remarcar.
async function loadSchedule(
  repo: TenantRepository,
  professionalId: string,
  date: string,
  timezone: string,
  excludeId?: string,
): Promise<ProfessionalSchedule> {
  const day = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  const range = { startsAt: day.minus({ days: 1 }).toJSDate(), endsAt: day.plus({ days: 2 }).toJSDate() };
  const [workingHours, timeBlocks, appointments] = await Promise.all([
    repo.workingHours.list(professionalId),
    repo.timeBlocks.listRange({ ...range, professionalId }),
    repo.appointments.listRange({ ...range, professionalId, statuses: ["confirmed"] }),
  ]);
  return {
    professionalId,
    workingHours: workingHours ?? [],
    timeBlocks,
    appointments: appointments.filter((appointment) => appointment.id !== excludeId),
  };
}

export async function assertSlotFree(
  repo: TenantRepository,
  settings: AgendaSettings,
  professionalId: string,
  startsAt: Date,
  durationMinutes: number,
  now: Date,
  excludeId?: string,
  audience: Audience = "owner",
): Promise<void> {
  const date = DateTime.fromJSDate(startsAt, { zone: settings.timezone }).toISODate()!;
  const schedule = await loadSchedule(repo, professionalId, date, settings.timezone, excludeId);
  const ctx: AvailabilityContext = { timezone: settings.timezone, now, durationMinutes, params: paramsFor(settings, audience) };
  if (!isSlotAvailable(ctx, schedule, startsAt)) throw new SlotUnavailableError();
}

export interface ManualAppointmentInput {
  professionalId: string;
  serviceId: string;
  startsAt: Date;
  contact: { name: string; phone: string; email?: string | null };
}

// Agendamento manual do dono: contato reencontrado pelo telefone normalizado, sem consentimento
// registrado (só o formulário público registra) e sem link de gestão.
export async function createManualAppointment(
  repo: TenantRepository,
  input: ManualAppointmentInput,
  now: Date = new Date(),
): Promise<AppointmentDetails | null> {
  const settings = await loadSettings(repo);
  const bookable = await loadBookable(repo, input.professionalId, input.serviceId);
  if (!bookable) return null;
  const { durationMinutes } = bookable.service;
  await assertSlotFree(repo, settings, input.professionalId, input.startsAt, durationMinutes, now);
  const contact = await repo.contacts.findOrCreateByPhone(input.contact);
  return repo.appointments.create({
    professionalId: input.professionalId,
    serviceId: input.serviceId,
    contactId: contact.id,
    startsAt: input.startsAt,
    endsAt: new Date(input.startsAt.getTime() + durationMinutes * MINUTE_MS),
  });
}

export interface RescheduleRequest {
  startsAt: Date;
  professionalId?: string;
}

// Remarcar mantém a duração gravada no agendamento, mesmo que o serviço tenha mudado depois.
// O cliente (site) remarca com a antecedência mínima e a janela máxima; o dono, sem elas.
export async function rescheduleAppointment(
  repo: TenantRepository,
  id: string,
  input: RescheduleRequest,
  now: Date = new Date(),
  audience: Audience = "owner",
): Promise<AppointmentDetails | null> {
  const current = await repo.appointments.findById(id);
  if (!current) return null;
  if (current.status !== "confirmed") throw new AppointmentStatusError(current.status);
  const professionalId = input.professionalId ?? current.professionalId;
  if (!(await loadBookable(repo, professionalId, current.serviceId))) return null;
  const durationMs = current.endsAt.getTime() - current.startsAt.getTime();
  const settings = await loadSettings(repo);
  await assertSlotFree(repo, settings, professionalId, input.startsAt, durationMs / MINUTE_MS, now, current.id, audience);
  return repo.appointments.reschedule(id, {
    startsAt: input.startsAt,
    endsAt: new Date(input.startsAt.getTime() + durationMs),
    professionalId,
  });
}

export interface SlotsQuery {
  serviceId: string;
  date: string;
  professionalId?: string;
}

// Horários livres de um dia como o cliente os vê (com antecedência e janela do tenant). Sem
// profissional, é o modo "qualquer profissional" entre os ativos que atendem o serviço.
export async function getAvailableSlots(
  repo: TenantRepository,
  query: SlotsQuery,
  now: Date = new Date(),
): Promise<AnyProfessionalSlot[] | null> {
  const settings = await loadSettings(repo);
  let professionalIds: string[];
  let durationMinutes: number;
  if (query.professionalId) {
    const bookable = await loadBookable(repo, query.professionalId, query.serviceId);
    if (!bookable) return null;
    professionalIds = [bookable.professional.id];
    durationMinutes = bookable.service.durationMinutes;
  } else {
    const service = await repo.services.findById(query.serviceId);
    if (!service) return null;
    if (service.archivedAt) throw new NotBookableError("Esse serviço está arquivado.");
    durationMinutes = service.durationMinutes;
    const professionals = await repo.professionals.list();
    const offers = await Promise.all(
      professionals.map(async (professional) => {
        const services = (await repo.professionalServices.listServices(professional.id)) ?? [];
        return services.some((item) => item.id === service.id) ? professional.id : null;
      }),
    );
    professionalIds = offers.filter((id): id is string => id !== null);
  }
  const schedules = await Promise.all(
    professionalIds.map((id) => loadSchedule(repo, id, query.date, settings.timezone)),
  );
  const ctx: AvailabilityContext = { timezone: settings.timezone, now, durationMinutes, params: agendaParams(settings) };
  return getAnyProfessionalDaySlots(ctx, schedules, query.date);
}
