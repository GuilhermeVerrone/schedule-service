import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { agendaSettingsSchema, normalizedPhoneSchema } from "@/server/validation/agenda";

// Entrada das rotas do painel da agenda (guia 7d, 7e; D3, D4, D9). Datas chegam em ISO 8601 com
// fuso explícito (Z ou ±HH:MM) e viram Date em UTC; dias chegam como "YYYY-MM-DD" no fuso do tenant.

// Teto da janela de leitura da agenda: cobre a visão de semana e de mês com folga.
export const AGENDA_RANGE_MAX_DAYS = 62;
const DAY_MS = 86_400_000;

const instant = (label: string) =>
  z
    .iso.datetime({ offset: true, error: `${label}: use data e hora ISO 8601 com fuso (ex.: 2026-10-20T13:00:00Z).` })
    .transform((value) => new Date(value));

const idField = (label: string) => z.string({ error: `Informe ${label}.` }).min(1, { error: `Informe ${label}.` });

// No Zod 4 o refine do objeto roda mesmo com um campo inválido: só compara datas que viraram Date.
const bothDates = (a: unknown, b: unknown): boolean => a instanceof Date && b instanceof Date;

const atLeastOneField = (value: object) => Object.values(value).some((field) => field !== undefined);

// Telefone como a pessoa digita ("(11) 98765-4321", "+55 11 98765-4321") vira E.164 pela função
// única (src/lib/phone.ts); o que não normaliza segue como veio e é recusado pelo schema.
export const phoneInput = (error: string) =>
  z
    .string({ error })
    .transform((value) => normalizePhone(value) ?? value)
    .pipe(normalizedPhoneSchema);

export const settingsBodySchema = agendaSettingsSchema.refine(atLeastOneField, {
  error: "Informe ao menos um campo para alterar.",
});

export const rangeQuerySchema = z
  .object({
    from: instant("Início"),
    to: instant("Fim"),
    professionalId: z.string().optional(),
  })
  .refine((query) => !bothDates(query.from, query.to) || query.to > query.from, {
    error: "O fim deve ser depois do início.",
    path: ["to"],
  })
  .refine((query) => !bothDates(query.from, query.to) || query.to.getTime() - query.from.getTime() <= AGENDA_RANGE_MAX_DAYS * DAY_MS, {
    error: `O intervalo pode ter no máximo ${AGENDA_RANGE_MAX_DAYS} dias.`,
    path: ["to"],
  });

export const appointmentListQuerySchema = z.intersection(
  rangeQuerySchema,
  z.object({
    status: z
      .enum(["confirmed", "canceled", "completed"], { error: "Status inválido." })
      .optional(),
  }),
);

// Agendamento manual do dono: o fim sai da duração do serviço, nunca do corpo.
export const appointmentCreateSchema = z.object({
  professionalId: idField("o profissional"),
  serviceId: idField("o serviço"),
  startsAt: instant("Início"),
  contact: z.object(
    {
      name: z
        .string({ error: "Informe o nome do cliente." })
        .trim()
        .min(2, { error: "Informe o nome do cliente." })
        .max(80, { error: "O nome do cliente pode ter no máximo 80 caracteres." }),
      phone: phoneInput("Informe o telefone do cliente."),
      email: z
        .string()
        .trim()
        .transform((value) => (value === "" ? null : value))
        .pipe(z.email({ error: "E-mail inválido." }).max(254).nullable())
        .nullish(),
    },
    { error: "Informe os dados do cliente." },
  ),
});

export const rescheduleSchema = z.object({
  startsAt: instant("Início"),
  professionalId: z.string().min(1).optional(),
});

export const timeBlockCreateSchema = z
  .object({
    professionalId: idField("o profissional"),
    startsAt: instant("Início"),
    endsAt: instant("Fim"),
    reason: z.string().nullish(),
  })
  .refine((block) => !bothDates(block.startsAt, block.endsAt) || block.endsAt > block.startsAt, { error: "O fim deve ser depois do início.", path: ["endsAt"] });

export const availabilityQuerySchema = z.object({
  serviceId: idField("o serviço"),
  date: z.iso.date({ error: "Informe o dia no formato AAAA-MM-DD." }),
  professionalId: z.string().min(1).optional(),
});
