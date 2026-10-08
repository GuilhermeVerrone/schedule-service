import { z } from "zod";

// Horários de trabalho (D5): vários intervalos por dia, fim > início, sem sobreposição.
// Horas chegam como "HH:MM" no fuso do tenant e viram minutos desde 00:00 (fim exclusivo, 24:00 = 1440).

export const MINUTES_PER_DAY = 1440;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export const timeOfDaySchema = z
  .string()
  .regex(TIME_PATTERN, "Use o formato HH:MM, de 00:00 a 24:00")
  .transform((value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  });

// 0 = domingo ... 6 = sábado (mesmo padrão de Date.getDay()).
export const weekdaySchema = z.int().min(0).max(6);

export const workingHoursIntervalSchema = z
  .object({
    weekday: weekdaySchema,
    start: timeOfDaySchema,
    end: timeOfDaySchema,
  })
  .refine((interval) => interval.start < MINUTES_PER_DAY, {
    message: "O início não pode ser 24:00",
    path: ["start"],
  })
  .refine((interval) => interval.end > interval.start, {
    message: "O fim deve ser depois do início",
    path: ["end"],
  })
  .transform(({ weekday, start, end }) => ({ weekday, startMinute: start, endMinute: end }));

export type WorkingHoursInput = z.input<typeof workingHoursIntervalSchema>;
export type WorkingHoursInterval = z.output<typeof workingHoursIntervalSchema>;

// Intervalos [início, fim): encostar (12:00-12:00) não é sobreposição.
export function intervalsOverlap(a: WorkingHoursInterval, b: WorkingHoursInterval): boolean {
  return a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function findOverlap(
  intervals: readonly WorkingHoursInterval[],
): [number, number] | null {
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervalsOverlap(intervals[i], intervals[j])) return [i, j];
    }
  }
  return null;
}

// Grade semanal completa de um profissional (substitui todos os intervalos).
export const weeklyScheduleSchema = z
  .array(workingHoursIntervalSchema)
  .max(7 * 24, "Intervalos demais")
  .superRefine((intervals, ctx) => {
    const overlap = findOverlap(intervals);
    if (overlap) {
      ctx.addIssue({
        code: "custom",
        message: "Há intervalos sobrepostos no mesmo dia",
        path: [overlap[1]],
      });
    }
  });
