import { DateTime } from "luxon";

// Datas da agenda do painel no fuso do negócio (D11): a tela fala em dias "AAAA-MM-DD" e horas
// "HH:MM" locais; a API recebe e devolve instantes ISO em UTC. A conversão é sempre do luxon,
// nunca somando horas fixas (horário de verão incluído). Semana começa na segunda.

export type AgendaView = "day" | "week";

const LOCALE = "pt-BR";

function day(date: string, timezone: string): DateTime {
  return DateTime.fromISO(date, { zone: timezone }).startOf("day");
}

export function todayIn(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date).isValid;
}

// Primeiro dia (segunda) da semana que contém `date`.
export function weekStart(date: string): string {
  return DateTime.fromISO(date).startOf("week").toISODate()!;
}

// Dias exibidos e o intervalo [from, to) em UTC que a API lê para eles.
export function rangeOf(view: AgendaView, date: string, timezone: string): { days: string[]; from: string; to: string } {
  const first = view === "day" ? date : weekStart(date);
  const count = view === "day" ? 1 : 7;
  const days = Array.from({ length: count }, (_, index) => DateTime.fromISO(first).plus({ days: index }).toISODate()!);
  const from = day(first, timezone);
  const to = from.plus({ days: count });
  return { days, from: from.toUTC().toISO()!, to: to.toUTC().toISO()! };
}

export function shiftDate(view: AgendaView, date: string, direction: -1 | 1): string {
  return DateTime.fromISO(date).plus(view === "day" ? { days: direction } : { weeks: direction }).toISODate()!;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

// Instante ISO → dia e hora no fuso do negócio.
export function localDate(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toISODate()!;
}

export function localTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("HH:mm");
}

// Dia + hora digitados no fuso do negócio → instante ISO em UTC. null quando a hora não existe
// nesse dia (salto do horário de verão) ou o texto é inválido.
export function toInstant(date: string, time: string, timezone: string): string | null {
  if (!isValidDate(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const local = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== `${date}T${time}`) return null;
  return local.toUTC().toISO()!;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "Sexta-feira, 10 de outubro" (com o ano quando não é o ano corrente).
export function formatDayTitle(date: string, today: string): string {
  const value = DateTime.fromISO(date).setLocale(LOCALE);
  const sameYear = value.year === DateTime.fromISO(today).year;
  return capitalize(value.toFormat(sameYear ? "cccc, d 'de' LLLL" : "cccc, d 'de' LLLL 'de' yyyy"));
}

// "6 a 12 de outubro", "29 de setembro a 5 de outubro", "29 de dezembro de 2026 a 4 de janeiro de 2027".
export function formatWeekTitle(days: readonly string[]): string {
  const first = DateTime.fromISO(days[0]).setLocale(LOCALE);
  const last = DateTime.fromISO(days[days.length - 1]).setLocale(LOCALE);
  if (first.year !== last.year) {
    return `${first.toFormat("d 'de' LLLL 'de' yyyy")} a ${last.toFormat("d 'de' LLLL 'de' yyyy")}`;
  }
  if (first.month !== last.month) return `${first.toFormat("d 'de' LLLL")} a ${last.toFormat("d 'de' LLLL")}`;
  return `${first.day} a ${last.toFormat("d 'de' LLLL")}`;
}

// Cabeçalho curto de um dia da semana: { weekday: "Seg", day: "6" }.
export function dayParts(date: string): { weekday: string; day: string; long: string } {
  const value = DateTime.fromISO(date).setLocale(LOCALE);
  return {
    weekday: capitalize(value.toFormat("ccc").replace(".", "")),
    day: String(value.day),
    long: capitalize(value.toFormat("cccc, d 'de' LLLL")),
  };
}
