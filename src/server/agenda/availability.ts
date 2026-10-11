import { DateTime } from "luxon";

// Cálculo de horários livres (guia 6; D3, D4, D11). Função pura: não lê banco nem relógio,
// o "agora" vem de quem chama. Toda conversão de fuso passa pelo Luxon, nunca por horas fixas.
//
// Regras:
// - Os horários de trabalho são relógio local do tenant (minutos desde 00:00, fim exclusivo,
//   1440 = meia-noite seguinte) e viram instantes UTC no dia em questão. Intervalos que se
//   encostam (inclusive 24:00 de um dia com 00:00 do seguinte) se juntam: um serviço pode
//   atravessar a meia-noite se o profissional trabalha dos dois lados.
// - A grade parte do início de cada intervalo contínuo de trabalho e anda em tempo real
//   (minutos corridos), então a duração é sempre a real, mesmo no dia de horário de verão.
//   Um horário local que não existe (pulo do relógio) vai para o primeiro instante válido.
// - O horário [início, início + duração) cabe inteiro no trabalho e não cruza bloqueio.
// - Buffer: folga obrigatória entre dois agendamentos do mesmo profissional, antes e depois
//   do novo. Não vale para bloqueios nem para o fim do expediente.
// - Só agendamento `confirmed` ocupa horário (D4); os outros status são ignorados.
// - Antecedência mínima: início >= agora + minAdvanceMinutes.
// - Janela máxima: só dias de hoje (no fuso do tenant) até hoje + maxWindowDays - 1.
// - O dia de um horário é a data local do seu início.

export type WorkingInterval = { weekday: number; startMinute: number; endMinute: number };
export type BusyInterval = { startsAt: Date; endsAt: Date };
export type ScheduledAppointment = BusyInterval & { status: string };

export type AgendaParams = {
  slotStepMinutes: number;
  bufferMinutes: number;
  minAdvanceMinutes: number;
  maxWindowDays: number;
};

export type ProfessionalSchedule = {
  professionalId: string;
  workingHours: readonly WorkingInterval[];
  timeBlocks: readonly BusyInterval[];
  appointments: readonly ScheduledAppointment[];
};

export type AvailabilityContext = {
  timezone: string;
  now: Date;
  durationMinutes: number;
  params: AgendaParams;
};

export type AnyProfessionalSlot = { startsAt: Date; professionalIds: string[] };
export type DaySlots<T> = { date: string; slots: T[] };

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 1440;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Range = { start: number; end: number };

function localDay(date: string, timezone: string): DateTime {
  if (!DATE_PATTERN.test(date)) throw new RangeError(`Data inválida: ${date}`);
  const day = DateTime.fromISO(date, { zone: timezone });
  if (!day.isValid) throw new RangeError(`Data ou fuso inválido: ${date} ${timezone}`);
  return day.startOf("day");
}

function assertContext({ timezone, durationMinutes, params }: AvailabilityContext): void {
  if (!DateTime.local().setZone(timezone).isValid) throw new RangeError(`Fuso inválido: ${timezone}`);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError("A duração deve ser um inteiro positivo");
  }
  if (!Number.isInteger(params.slotStepMinutes) || params.slotStepMinutes <= 0) {
    throw new RangeError("O passo da grade deve ser um inteiro positivo");
  }
  for (const key of ["bufferMinutes", "minAdvanceMinutes", "maxWindowDays"] as const) {
    if (!Number.isInteger(params[key]) || params[key] < 0) {
      throw new RangeError(`${key} deve ser um inteiro não negativo`);
    }
  }
}

// Data local "YYYY-MM-DD" de hoje + offset dias, no fuso do tenant.
function todayPlus(now: Date, timezone: string, days: number): string {
  return DateTime.fromJSDate(now, { zone: timezone }).startOf("day").plus({ days }).toISODate()!;
}

function isInsideWindow(date: string, ctx: AvailabilityContext): boolean {
  const first = todayPlus(ctx.now, ctx.timezone, 0);
  const last = todayPlus(ctx.now, ctx.timezone, ctx.params.maxWindowDays - 1);
  return date >= first && date <= last;
}

// Minuto local do dia -> instante UTC. 1440 vira a meia-noite do dia seguinte.
function wallClockToMs(day: DateTime, minute: number): number {
  const base = minute >= MINUTES_PER_DAY ? day.plus({ days: 1 }) : day;
  const rest = minute % MINUTES_PER_DAY;
  return DateTime.fromObject(
    { year: base.year, month: base.month, day: base.day, hour: Math.floor(rest / 60), minute: rest % 60 },
    { zone: day.zone },
  ).toMillis();
}

function weekdayOf(day: DateTime): number {
  return day.weekday % 7; // Luxon: 1 = segunda ... 7 = domingo; aqui 0 = domingo.
}

// Trabalho de ontem, hoje e amanhã em UTC, juntando intervalos que se encostam.
function workRanges(day: DateTime, workingHours: readonly WorkingInterval[]): Range[] {
  const ranges: Range[] = [];
  for (const offset of [-1, 0, 1]) {
    const current = day.plus({ days: offset }).startOf("day");
    const weekday = weekdayOf(current);
    for (const interval of workingHours) {
      if (interval.weekday !== weekday) continue;
      const start = wallClockToMs(current, interval.startMinute);
      const end = wallClockToMs(current, interval.endMinute);
      if (end > start) ranges.push({ start, end });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function toRanges(intervals: readonly BusyInterval[], padMs = 0): Range[] {
  return intervals.map((interval) => ({
    start: interval.startsAt.getTime() - padMs,
    end: interval.endsAt.getTime() + padMs,
  }));
}

function overlapsAny(start: number, end: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => start < range.end && range.start < end);
}

// Horários livres (inícios em UTC, em ordem) de um profissional num dia local "YYYY-MM-DD".
export function getDaySlots(
  ctx: AvailabilityContext,
  schedule: ProfessionalSchedule,
  date: string,
): Date[] {
  assertContext(ctx);
  const day = localDay(date, ctx.timezone);
  if (!isInsideWindow(date, ctx)) return [];

  const dayStart = day.toMillis();
  const dayEnd = day.plus({ days: 1 }).startOf("day").toMillis();
  const earliest = ctx.now.getTime() + ctx.params.minAdvanceMinutes * MINUTE_MS;
  const stepMs = ctx.params.slotStepMinutes * MINUTE_MS;
  const durationMs = ctx.durationMinutes * MINUTE_MS;

  const blocks = toRanges(schedule.timeBlocks);
  const appointments = toRanges(
    schedule.appointments.filter((appointment) => appointment.status === "confirmed"),
    ctx.params.bufferMinutes * MINUTE_MS,
  );

  const slots: Date[] = [];
  for (const work of workRanges(day, schedule.workingHours)) {
    for (let start = work.start; start + durationMs <= work.end; start += stepMs) {
      if (start < dayStart || start < earliest) continue;
      if (start >= dayEnd) break;
      const end = start + durationMs;
      if (overlapsAny(start, end, blocks) || overlapsAny(start, end, appointments)) continue;
      slots.push(new Date(start));
    }
  }
  return slots;
}

// Datas locais de from até to (inclusive), em ordem.
function datesBetween(from: string, to: string, timezone: string): string[] {
  const last = localDay(to, timezone);
  const dates: string[] = [];
  for (let day = localDay(from, timezone); day <= last; day = day.plus({ days: 1 }).startOf("day")) {
    dates.push(day.toISODate()!);
  }
  return dates;
}

// Horários livres de um profissional em cada dia de from até to (inclusive).
export function getWindowSlots(
  ctx: AvailabilityContext,
  schedule: ProfessionalSchedule,
  from: string,
  to: string,
): DaySlots<Date>[] {
  return datesBetween(from, to, ctx.timezone).map((date) => ({
    date,
    slots: getDaySlots(ctx, schedule, date),
  }));
}

// "Qualquer profissional": união dos horários do dia, com quem está livre em cada um
// (na ordem recebida, para quem chama escolher o primeiro).
export function getAnyProfessionalDaySlots(
  ctx: AvailabilityContext,
  schedules: readonly ProfessionalSchedule[],
  date: string,
): AnyProfessionalSlot[] {
  const byStart = new Map<number, string[]>();
  for (const schedule of schedules) {
    for (const slot of getDaySlots(ctx, schedule, date)) {
      const ids = byStart.get(slot.getTime()) ?? [];
      ids.push(schedule.professionalId);
      byStart.set(slot.getTime(), ids);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, professionalIds]) => ({ startsAt: new Date(start), professionalIds }));
}

export function getAnyProfessionalWindowSlots(
  ctx: AvailabilityContext,
  schedules: readonly ProfessionalSchedule[],
  from: string,
  to: string,
): DaySlots<AnyProfessionalSlot>[] {
  return datesBetween(from, to, ctx.timezone).map((date) => ({
    date,
    slots: getAnyProfessionalDaySlots(ctx, schedules, date),
  }));
}

// Confere se um início escolhido é um dos horários livres do seu dia (para a API validar).
export function isSlotAvailable(
  ctx: AvailabilityContext,
  schedule: ProfessionalSchedule,
  startsAt: Date,
): boolean {
  const date = DateTime.fromJSDate(startsAt, { zone: ctx.timezone }).toISODate();
  if (!date) return false;
  return getDaySlots(ctx, schedule, date).some((slot) => slot.getTime() === startsAt.getTime());
}
