import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import {
  assertSlotFree,
  getAvailableSlots,
  loadBookable,
  loadSettings,
  MINUTE_MS,
  rescheduleAppointment,
  SlotUnavailableError,
  type RescheduleRequest,
} from "@/server/agenda/booking";
import {
  AppointmentConflictError,
  AppointmentStatusError,
  type AgendaSettings,
  type AppointmentDetails,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";

// Agendamento pelo site público (guia 6, 7a, 7b, 7c; D5, D6, D8). O repositório já vem do tenant
// resolvido pelo slug; aqui ficam as regras do cliente: antecedência mínima e janela máxima,
// consentimento LGPD, token de gestão (só o SHA-256 no banco) e o prazo para cancelar e remarcar.

// Origem do consentimento registrada no cliente (LGPD).
export const PUBLIC_CONSENT_SOURCE = "public_booking";

// Cancelar ou remarcar depois do prazo configurado pelo negócio (D6).
export class DeadlinePassedError extends Error {
  constructor() {
    super("Prazo para cancelar ou remarcar já passou");
    this.name = "DeadlinePassedError";
  }
}

// 32 bytes aleatórios em base64url: sempre 43 caracteres.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function issueManageToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashManageToken(token) };
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isManageToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export interface PublicBookingInput {
  serviceId: string;
  // Ausente ou null: "qualquer profissional disponível".
  professionalId?: string | null;
  startsAt: Date;
  contact: { name: string; phone: string; email?: string | null };
}

export interface PublicBookingResult {
  appointment: AppointmentDetails;
  // Mostrado uma única vez ao cliente; o banco guarda só o hash.
  token: string;
}

// Profissionais que podem receber o horário, na ordem em que serão tentados.
async function candidatesFor(
  repo: TenantRepository,
  settings: AgendaSettings,
  input: PublicBookingInput,
  durationMinutes: number | null,
  now: Date,
): Promise<string[] | null> {
  if (input.professionalId) {
    await assertSlotFree(repo, settings, input.professionalId, input.startsAt, durationMinutes!, now, undefined, "customer");
    return [input.professionalId];
  }
  const date = DateTime.fromJSDate(input.startsAt, { zone: settings.timezone }).toISODate()!;
  const slots = await getAvailableSlots(repo, { serviceId: input.serviceId, date }, now);
  if (!slots) return null;
  const slot = slots.find((item) => item.startsAt.getTime() === input.startsAt.getTime());
  if (!slot || slot.professionalIds.length === 0) throw new SlotUnavailableError();
  return slot.professionalIds;
}

// null = serviço ou profissional fora do tenant (a rota dá 404). No modo "qualquer profissional",
// se outro cliente levar o horário de um profissional na corrida, tenta o próximo livre.
export async function createPublicAppointment(
  repo: TenantRepository,
  input: PublicBookingInput,
  now: Date = new Date(),
): Promise<PublicBookingResult | null> {
  const settings = await loadSettings(repo);
  let durationMinutes: number;
  if (input.professionalId) {
    const bookable = await loadBookable(repo, input.professionalId, input.serviceId);
    if (!bookable) return null;
    durationMinutes = bookable.service.durationMinutes;
  } else {
    const service = await repo.services.findById(input.serviceId);
    if (!service) return null;
    durationMinutes = service.durationMinutes;
  }
  const candidates = await candidatesFor(repo, settings, input, durationMinutes, now);
  if (!candidates) return null;

  const contact = await repo.contacts.findOrCreateByPhone(input.contact, { source: PUBLIC_CONSENT_SOURCE, at: now });
  const { token, tokenHash } = issueManageToken();
  const endsAt = new Date(input.startsAt.getTime() + durationMinutes * MINUTE_MS);
  let conflict: AppointmentConflictError | null = null;
  for (const professionalId of candidates) {
    try {
      const appointment = await repo.appointments.create({
        professionalId,
        serviceId: input.serviceId,
        contactId: contact.id,
        startsAt: input.startsAt,
        endsAt,
        manageTokenHash: tokenHash,
      });
      if (!appointment) return null;
      return { appointment, token };
    } catch (error) {
      if (!(error instanceof AppointmentConflictError)) throw error;
      conflict = error;
    }
  }
  throw conflict ?? new SlotUnavailableError();
}

export interface ManageState {
  // Último instante em que o cliente ainda cancela ou remarca.
  manageableUntil: Date;
  canManage: boolean;
}

export function manageState(appointment: AppointmentDetails, settings: AgendaSettings, now: Date): ManageState {
  const manageableUntil = new Date(appointment.startsAt.getTime() - settings.cancelDeadlineMinutes * MINUTE_MS);
  return {
    manageableUntil,
    canManage: appointment.status === "confirmed" && now.getTime() <= manageableUntil.getTime(),
  };
}

// Token malformado ou de outro tenant se comporta como inexistente, sem chegar a comparar nada.
export function findByManageToken(repo: TenantRepository, token: string): Promise<AppointmentDetails | null> {
  if (!isManageToken(token)) return Promise.resolve(null);
  return repo.appointments.findByManageTokenHash(hashManageToken(token));
}

async function loadManageable(
  repo: TenantRepository,
  token: string,
): Promise<{ appointment: AppointmentDetails; settings: AgendaSettings } | null> {
  const appointment = await findByManageToken(repo, token);
  if (!appointment) return null;
  return { appointment, settings: await loadSettings(repo) };
}

// Cancelar de novo devolve o cancelado; concluído não cancela; fora do prazo, nada muda.
export async function cancelByToken(
  repo: TenantRepository,
  token: string,
  now: Date = new Date(),
): Promise<AppointmentDetails | null> {
  const loaded = await loadManageable(repo, token);
  if (!loaded) return null;
  const { appointment, settings } = loaded;
  if (appointment.status === "canceled") return appointment;
  if (appointment.status !== "confirmed") throw new AppointmentStatusError(appointment.status);
  if (!manageState(appointment, settings, now).canManage) throw new DeadlinePassedError();
  return repo.appointments.cancel(appointment.id, now);
}

// Remarcar pelo link: dentro do prazo do horário atual e com as regras do cliente no novo horário.
export async function rescheduleByToken(
  repo: TenantRepository,
  token: string,
  input: RescheduleRequest,
  now: Date = new Date(),
): Promise<AppointmentDetails | null> {
  const loaded = await loadManageable(repo, token);
  if (!loaded) return null;
  const { appointment, settings } = loaded;
  if (appointment.status !== "confirmed") throw new AppointmentStatusError(appointment.status);
  if (!manageState(appointment, settings, now).canManage) throw new DeadlinePassedError();
  return rescheduleAppointment(repo, appointment.id, input, now, "customer");
}
