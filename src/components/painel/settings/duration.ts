// Tempo da agenda (D3) é gravado em minutos; na tela, o dono escolhe minutos, horas ou dias.
// Ao abrir, cada valor aparece na maior unidade que o divide sem sobra (120 → 2 horas).

export type DurationUnit = "minutes" | "hours" | "days";

export const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export const UNIT_LABELS: Record<DurationUnit, string> = { minutes: "minutos", hours: "horas", days: "dias" };

export function splitMinutes(total: number): { amount: number; unit: DurationUnit } {
  if (total > 0 && total % UNIT_MINUTES.days === 0) return { amount: total / UNIT_MINUTES.days, unit: "days" };
  if (total > 0 && total % UNIT_MINUTES.hours === 0) return { amount: total / UNIT_MINUTES.hours, unit: "hours" };
  return { amount: total, unit: "minutes" };
}

// Texto digitado → minutos inteiros. Vazio, negativo, fracionário que não fecha em minuto ou
// texto qualquer viram null. Aceita vírgula decimal ("1,5" horas = 90).
export function toMinutes(raw: string, unit: DurationUnit): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  // Tolerância só para o erro de ponto flutuante (1,1 hora = 66.00000000000001).
  const minutes = Number(text) * UNIT_MINUTES[unit];
  const rounded = Math.round(minutes);
  return Math.abs(minutes - rounded) < 1e-9 ? rounded : null;
}

// Minutos → texto curto para as dicas ("2 horas", "1 dia", "45 minutos", "0 minutos").
export function formatMinutes(total: number): string {
  const { amount, unit } = splitMinutes(total);
  const singular = { minutes: "minuto", hours: "hora", days: "dia" }[unit];
  return `${amount} ${amount === 1 ? singular : UNIT_LABELS[unit]}`;
}
