import { DateTime } from "luxon";
import type { OutboundMessageType } from "./message-types";

// Política de envio por número (tenant), pura e sem Redis (guia 6, 7e; D3, D7, D9, D11, D14).
// Decide se uma mensagem sai agora, espera (até quando e por quê) ou expira. O teto em si é
// garantido no banco pelo contador atômico (`sendCounter.consume`); aqui só se calcula o limite.

// D3: intervalo aleatório entre mensagens do mesmo número, em ms (inclusive nas duas pontas).
export const SEND_INTERVAL_MIN_MS = 8_000;
export const SEND_INTERVAL_MAX_MS = 25_000;

// D3: curva de aquecimento contada em dias do fuso do tenant desde a primeira conexão
// `connected` (dia 1 = o dia da primeira conexão). Reconexão não zera.
export const WARMUP_DAYS = 14;
export const MATURE_DAILY_LIMIT = 200;
export const WARMUP_STEPS: readonly { fromDay: number; limit: number }[] = [
  { fromDay: 1, limit: 20 },
  { fromDay: 3, limit: 40 },
  { fromDay: 5, limit: 80 },
  { fromDay: 7, limit: 120 },
  { fromDay: 9, limit: 160 },
  { fromDay: 11, limit: MATURE_DAILY_LIMIT },
];

// D11: proativas só entre 8h (inclusive) e 20h (exclusive) do fuso do tenant.
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 20;

// D7: mensagem com mais de 24 h de atraso (contado do momento em que deveria sair) expira.
export const SEND_EXPIRY_MS = 24 * 60 * 60 * 1000;

// D7, D11: confirmação de agendamento passa na frente e não espera a janela. Prioridade no
// formato do BullMQ (1 é a mais alta).
interface TypePolicy {
  windowExempt: boolean;
  priority: number;
}

const TYPE_POLICY: Record<OutboundMessageType, TypePolicy> = {
  appointment_confirmation: { windowExempt: true, priority: 1 },
  optout_confirmation: { windowExempt: false, priority: 2 },
};

export const sendPriority = (type: OutboundMessageType): number => TYPE_POLICY[type].priority;

// Ordem de saída das mensagens que esperam: prioridade e, dentro dela, quem devia sair antes.
export function compareSendOrder(
  a: { messageType: OutboundMessageType; dueAt: Date },
  b: { messageType: OutboundMessageType; dueAt: Date },
): number {
  return sendPriority(a.messageType) - sendPriority(b.messageType) || a.dueAt.getTime() - b.dueAt.getTime();
}

export function randomSendIntervalMs(random: () => number = Math.random): number {
  const span = SEND_INTERVAL_MAX_MS - SEND_INTERVAL_MIN_MS + 1;
  return SEND_INTERVAL_MIN_MS + Math.min(Math.floor(random() * span), span - 1);
}

// Próximo envio permitido do número depois de um envio feito em `sentAt`.
export const nextSendAllowedAt = (sentAt: Date, random: () => number = Math.random): Date =>
  new Date(sentAt.getTime() + randomSendIntervalMs(random));

function local(date: Date, timezone: string): DateTime {
  const value = DateTime.fromJSDate(date, { zone: timezone });
  if (!value.isValid) throw new RangeError(`Fuso inválido: ${timezone}`);
  return value;
}

// D9: o "dia" do teto vira à meia-noite do fuso do tenant. Formato YYYY-MM-DD.
export const tenantDay = (now: Date, timezone: string): string => local(now, timezone).toISODate()!;

// Dia do aquecimento, a partir de 1. Sem primeira conexão, é o dia 1 (o limite mais baixo).
export function warmupDay(firstConnectedAt: Date | null, now: Date, timezone: string): number {
  if (!firstConnectedAt) return 1;
  const first = local(firstConnectedAt, timezone).startOf("day");
  const today = local(now, timezone).startOf("day");
  return Math.max(1, Math.round(today.diff(first, "days").days) + 1);
}

export function warmupLimit(day: number): number {
  return WARMUP_STEPS.reduce((limit, step) => (day >= step.fromDay ? step.limit : limit), WARMUP_STEPS[0].limit);
}

export interface DailyLimitInput {
  firstConnectedAt: Date | null;
  // D14: teto manual opcional do dono (`daily_send_limit`); nunca é ultrapassado. Nulo = sem teto.
  manualLimit: number | null;
  now: Date;
  timezone: string;
}

export function warmupStatus({ firstConnectedAt, manualLimit, now, timezone }: DailyLimitInput) {
  const day = warmupDay(firstConnectedAt, now, timezone);
  const curve = warmupLimit(day);
  return {
    day,
    inWarmup: day <= WARMUP_DAYS,
    limit: manualLimit === null ? curve : Math.min(curve, manualLimit),
  };
}

export const dailyLimit = (input: DailyLimitInput): number => warmupStatus(input).limit;

// Envios já contados hoje: o contador de outro dia vale zero.
export const usedToday = (counter: { sentCount: number; countDate: string | null }, day: string): number =>
  counter.countDate === day ? counter.sentCount : 0;

export function isWithinSendWindow(now: Date, timezone: string): boolean {
  const { hour } = local(now, timezone);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

// Próxima abertura da janela (8h) a partir de `now`: hoje se ainda não abriu, senão amanhã.
export function nextWindowOpen(now: Date, timezone: string): Date {
  const at = local(now, timezone);
  const today = at.set({ hour: SEND_WINDOW_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  return (at < today ? today : today.plus({ days: 1 })).toJSDate();
}

export const startOfNextDay = (now: Date, timezone: string): Date =>
  local(now, timezone).startOf("day").plus({ days: 1 }).toJSDate();

export interface SendPolicyInput extends DailyLimitInput {
  messageType: OutboundMessageType;
  // Momento em que a mensagem deveria sair (o `scheduled_for` original): base da expiração.
  dueAt: Date;
  counter: { sentCount: number; countDate: string | null };
  // Fim do intervalo aleatório desde o último envio do número (`nextSendAllowedAt`).
  notBefore?: Date | null;
}

export type DeferReason = "daily_limit" | "outside_window" | "interval";

export type SendDecision =
  | { action: "send"; day: string; limit: number }
  | { action: "defer"; reason: DeferReason; until: Date }
  | { action: "expire"; reason: "expired" };

export function evaluateSendPolicy(input: SendPolicyInput): SendDecision {
  const { messageType, dueAt, now, timezone } = input;
  const { windowExempt } = TYPE_POLICY[messageType];
  const expiresAt = dueAt.getTime() + SEND_EXPIRY_MS;
  if (now.getTime() > expiresAt) return { action: "expire", reason: "expired" };

  // Espera que passaria do prazo vira expiração já, sem segurar a mensagem à toa.
  const defer = (reason: DeferReason, until: Date): SendDecision =>
    until.getTime() > expiresAt ? { action: "expire", reason: "expired" } : { action: "defer", reason, until };

  const day = tenantDay(now, timezone);
  const limit = dailyLimit(input);
  if (usedToday(input.counter, day) >= limit) {
    const nextDay = startOfNextDay(now, timezone);
    const until = windowExempt || isWithinSendWindow(nextDay, timezone) ? nextDay : nextWindowOpen(nextDay, timezone);
    return defer("daily_limit", until);
  }
  if (!windowExempt && !isWithinSendWindow(now, timezone)) {
    return defer("outside_window", nextWindowOpen(now, timezone));
  }
  if (input.notBefore && now < input.notBefore) return defer("interval", input.notBefore);
  return { action: "send", day, limit };
}

// Fallback por e-mail (Fase 8; guia 7d, D8): teto diário, aquecimento e intervalo protegem o
// número do WhatsApp e não se aplicam ao e-mail; a expiração de 24 h (D7) e a janela das 8h às
// 20h (D11, com a mesma exceção da confirmação de agendamento) valem para qualquer canal.
export interface EmailSendPolicyInput {
  messageType: OutboundMessageType;
  dueAt: Date;
  now: Date;
  timezone: string;
}

export type EmailSendDecision =
  | { action: "send" }
  | { action: "defer"; reason: "outside_window"; until: Date }
  | { action: "expire"; reason: "expired" };

export function evaluateEmailSendPolicy({ messageType, dueAt, now, timezone }: EmailSendPolicyInput): EmailSendDecision {
  const expiresAt = dueAt.getTime() + SEND_EXPIRY_MS;
  if (now.getTime() > expiresAt) return { action: "expire", reason: "expired" };
  if (!TYPE_POLICY[messageType].windowExempt && !isWithinSendWindow(now, timezone)) {
    const until = nextWindowOpen(now, timezone);
    return until.getTime() > expiresAt
      ? { action: "expire", reason: "expired" }
      : { action: "defer", reason: "outside_window", until };
  }
  return { action: "send" };
}
