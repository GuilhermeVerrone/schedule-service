import { z } from "zod";

// Entrada das rotas de profissionais, serviços, vínculos e horários (D5, D7).

export const DURATION_STEP_MINUTES = 5;
export const DURATION_MIN_MINUTES = 5;
export const DURATION_MAX_MINUTES = 480;
// Teto de R$ 1.000.000,00: cabe no Int do banco com folga.
export const PRICE_MAX_CENTS = 100_000_000;

const nameSchema = (label: string) =>
  z
    .string({ error: `Informe o nome ${label}.` })
    .trim()
    .min(2, { error: `O nome ${label} precisa ter pelo menos 2 caracteres.` })
    .max(80, { error: `O nome ${label} pode ter no máximo 80 caracteres.` });

const atLeastOneField = (value: object) => Object.values(value).some((field) => field !== undefined);
const NOTHING_TO_UPDATE = { error: "Informe ao menos um campo para alterar." };

export const professionalSchema = z.object({ name: nameSchema("do profissional") });

export const professionalUpdateSchema = professionalSchema.partial().refine(atLeastOneField, NOTHING_TO_UPDATE);

export const durationMinutesSchema = z
  .int({ error: "A duração deve ser um número inteiro de minutos." })
  .min(DURATION_MIN_MINUTES, { error: `A duração mínima é de ${DURATION_MIN_MINUTES} minutos.` })
  .max(DURATION_MAX_MINUTES, { error: `A duração máxima é de ${DURATION_MAX_MINUTES} minutos.` })
  .multipleOf(DURATION_STEP_MINUTES, { error: `A duração deve ser múltipla de ${DURATION_STEP_MINUTES} minutos.` });

// Dinheiro em centavos inteiros, nunca float.
export const priceCentsSchema = z
  .int({ error: "O preço deve ser um número inteiro de centavos." })
  .min(0, { error: "O preço não pode ser negativo." })
  .max(PRICE_MAX_CENTS, { error: "Preço alto demais." });

export const serviceSchema = z.object({
  name: nameSchema("do serviço"),
  durationMinutes: durationMinutesSchema,
  priceCents: priceCentsSchema,
});

export const serviceUpdateSchema = serviceSchema.partial().refine(atLeastOneField, NOTHING_TO_UPDATE);

export const serviceIdsSchema = z.object({
  serviceIds: z.array(z.string(), { error: "Informe a lista de serviços." }).max(200, { error: "Serviços demais." }),
});

// Forma do intervalo no corpo. As regras (HH:MM, fim > início, sobreposição) ficam no schema de
// horários, que o repositório aplica antes de gravar.
export const workingHoursBodySchema = z.object({
  weekday: z.int({ error: "Informe o dia da semana (0 = domingo a 6 = sábado)." }),
  start: z.string({ error: "Informe o início no formato HH:MM." }),
  end: z.string({ error: "Informe o fim no formato HH:MM." }),
});

export const weeklyScheduleBodySchema = z.object({
  intervals: z.array(workingHoursBodySchema, { error: "Informe a lista de intervalos." }),
});

export const listQuerySchema = z.object({
  includeArchived: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});
