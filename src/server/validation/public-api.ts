import { z } from "zod";
import { availabilityQuerySchema, phoneInput } from "@/server/validation/agenda-api";

// Entrada das rotas públicas (guia 6, 7a, 7c; D5, D6). Corpos estritos: campo a mais (como um
// tenantId) é recusado com 400, e o tenant vem só do slug da URL.

const instant = z
  .iso.datetime({ offset: true, error: "Horário: use data e hora ISO 8601 com fuso (ex.: 2026-10-20T13:00:00Z)." })
  .transform((value) => new Date(value));

const id = (label: string) => z.string({ error: `Informe ${label}.` }).min(1, { error: `Informe ${label}.` });

export const publicAvailabilityQuerySchema = availabilityQuerySchema;

export const publicBookingSchema = z.strictObject({
  serviceId: id("o serviço"),
  // null ou ausente: "qualquer profissional disponível".
  professionalId: z.string().min(1).nullish(),
  startsAt: instant,
  contact: z.strictObject(
    {
      name: z
        .string({ error: "Informe seu nome." })
        .trim()
        .min(2, { error: "Informe seu nome." })
        .max(80, { error: "O nome pode ter no máximo 80 caracteres." }),
      phone: phoneInput("Informe seu telefone com DDD."),
      email: z
        .string()
        .trim()
        .transform((value) => (value === "" ? null : value))
        .pipe(z.email({ error: "E-mail inválido." }).max(254).nullable())
        .nullish(),
    },
    { error: "Informe seus dados." },
  ),
  // LGPD (D5): sem o aceite explícito não há agendamento.
  consent: z.literal(true, { error: "É preciso aceitar o uso dos seus dados para agendar." }),
});

export const publicRescheduleSchema = z.strictObject({
  startsAt: instant,
  professionalId: z.string().min(1).optional(),
});
