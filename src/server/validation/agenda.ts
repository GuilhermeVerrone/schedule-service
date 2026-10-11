import { z } from "zod";

// Entrada dos repositórios da agenda (guia 5, D3, D5). As faixas espelham os CHECKs da migração
// 20261010035347_agenda_link_publico: o Zod barra antes, o banco garante mesmo contornando o código.

export const AGENDA_LIMITS = {
  slotStepMinutes: { min: 5, max: 120, step: 5 },
  bufferMinutes: { min: 0, max: 120, step: 5 },
  minAdvanceMinutes: { min: 0, max: 43_200 },
  maxWindowDays: { min: 1, max: 365 },
  cancelDeadlineMinutes: { min: 0, max: 43_200 },
} as const;

const bounded = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .int({ error: `${label} deve ser um número inteiro.` })
    .min(min, { error: `${label}: mínimo ${min}.` })
    .max(max, { error: `${label}: máximo ${max}.` });

const multipleOf5 = (schema: z.ZodInt, label: string) =>
  schema.multipleOf(5, { error: `${label} deve ser múltiplo de 5 minutos.` });

// Texto opcional do mini-site (D2): vazio vira null para limpar o campo.
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} pode ter no máximo ${max} caracteres.` })
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const agendaSettingsSchema = z
  .object({
    description: optionalText("A descrição", 1000),
    address: optionalText("O endereço", 200),
    phone: optionalText("O telefone", 30),
    slotStepMinutes: multipleOf5(bounded("O passo da grade", AGENDA_LIMITS.slotStepMinutes), "O passo da grade"),
    bufferMinutes: multipleOf5(bounded("O intervalo entre atendimentos", AGENDA_LIMITS.bufferMinutes), "O intervalo entre atendimentos"),
    minAdvanceMinutes: bounded("A antecedência mínima", AGENDA_LIMITS.minAdvanceMinutes),
    maxWindowDays: bounded("A janela máxima", AGENDA_LIMITS.maxWindowDays),
    cancelDeadlineMinutes: bounded("O prazo de cancelamento", AGENDA_LIMITS.cancelDeadlineMinutes),
  })
  .partial()
  .strict();

export type AgendaSettingsInput = z.input<typeof agendaSettingsSchema>;

// Telefone já normalizado (só dígitos, DDI 55), igual ao CHECK customers_phone_check.
export const normalizedPhoneSchema = z
  .string()
  .regex(/^55\d{10,11}$/, { error: "Telefone deve ter só dígitos, com DDI 55 e DDD." });

export const customerSchema = z.object({
  name: z.string().trim().min(2, { error: "Informe o nome do cliente." }).max(80),
  phone: normalizedPhoneSchema,
  email: z.email({ error: "E-mail inválido." }).max(254).nullish(),
});

export const customerUpdateSchema = customerSchema.partial();

export type CustomerInput = z.input<typeof customerSchema>;

// Intervalo [início, fim) em UTC.
export const dateRangeSchema = z
  .object({ startsAt: z.date(), endsAt: z.date() })
  .refine((range) => range.endsAt > range.startsAt, {
    error: "O fim deve ser depois do início.",
    path: ["endsAt"],
  });

export const timeBlockSchema = z.intersection(
  dateRangeSchema,
  z.object({ reason: optionalText("O motivo", 200).optional() }),
);

export type DateRange = z.input<typeof dateRangeSchema>;
export type TimeBlockInput = z.input<typeof timeBlockSchema>;
