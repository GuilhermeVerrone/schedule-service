import { DateTime } from "luxon";
import { normalizePhone } from "@/lib/phone";

// Datas do agendar e da gestão pelo link (guia 6, 7a, 7c; D11): a tela fala no fuso do negócio,
// a API recebe e devolve instantes ISO em UTC. Conversão sempre pelo luxon.

const LOCALE = "pt-BR";
export const WEEK_DAYS = 7;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function todayIn(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

// Último dia que o cliente pode escolher: hoje + janela máxima do negócio (D3).
export function lastBookableDay(today: string, maxWindowDays: number): string {
  return addDays(today, maxWindowDays);
}

// Os 7 dias de uma "página" da escolha de dia, a partir de hoje (página 0 começa hoje).
export function weekDays(today: string, page: number): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, index) => addDays(today, page * WEEK_DAYS + index));
}

// Página que contém o dia (para voltar ao dia escolhido depois de um 409).
export function pageOf(today: string, date: string): number {
  const diff = DateTime.fromISO(date).diff(DateTime.fromISO(today), "days").days;
  return Math.max(0, Math.floor(diff / WEEK_DAYS));
}

export function lastPage(today: string, maxWindowDays: number): number {
  return pageOf(today, lastBookableDay(today, maxWindowDays));
}

// Botão de um dia: { weekday: "Sex", day: "10", long: "Sexta-feira, 10 de outubro" }.
export function dayButton(date: string): { weekday: string; day: string; long: string } {
  const value = DateTime.fromISO(date).setLocale(LOCALE);
  return {
    weekday: capitalize(value.toFormat("ccc").replace(".", "")),
    day: String(value.day),
    long: capitalize(value.toFormat("cccc, d 'de' LLLL")),
  };
}

// Mês (ou meses) da semana visível: "Outubro de 2026", "Outubro e novembro de 2026".
export function monthsLabel(days: readonly string[]): string {
  const first = DateTime.fromISO(days[0]).setLocale(LOCALE);
  const last = DateTime.fromISO(days[days.length - 1]).setLocale(LOCALE);
  if (first.month === last.month) return capitalize(first.toFormat("LLLL 'de' yyyy"));
  if (first.year === last.year) return capitalize(`${first.toFormat("LLLL")} e ${last.toFormat("LLLL 'de' yyyy")}`);
  return capitalize(`${first.toFormat("LLLL 'de' yyyy")} e ${last.toFormat("LLLL 'de' yyyy")}`);
}

export function localTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("HH:mm");
}

export function localDate(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toISODate()!;
}

// "Sexta-feira, 10 de outubro de 2026" (o ano sempre: o link pode ser aberto meses depois).
export function formatLongDate(iso: string, timezone: string): string {
  return capitalize(DateTime.fromISO(iso, { zone: timezone }).setLocale(LOCALE).toFormat("cccc, d 'de' LLLL 'de' yyyy"));
}

// "Sexta-feira, 10 de outubro de 2026, das 14:00 às 14:45".
export function formatWhen(startsAt: string, endsAt: string, timezone: string): string {
  return `${formatLongDate(startsAt, timezone)}, das ${localTime(startsAt, timezone)} às ${localTime(endsAt, timezone)}`;
}

// "10/10/2026 às 12:00": prazo para cancelar ou remarcar.
export function formatDeadline(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("dd/MM/yyyy 'às' HH:mm");
}

// Telefone do cliente: a mesma função da API (DDD + número; DDI 55 opcional, outro DDI com "+").
export function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
