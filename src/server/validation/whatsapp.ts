import { z } from "zod";
import { isNormalizedPhone } from "@/lib/phone";
import { CONNECTION_STATES, DELIVERY_STATES, MEDIA_TYPES } from "@/server/whatsapp";

// Entradas dos repositórios do WhatsApp (guia 5, 6; D7, D8). Os eventos já chegam normalizados
// pelo provider, mas o repositório revalida: é a última barreira antes de gravar dado de tenant.

// Conversas e mensagens: 50 por página (D7), página a partir de 1.
export const WHATSAPP_PAGE_SIZE = 50;
export const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);

const sessionIdSchema = z.string().min(1).max(200);
const eventIdSchema = z.string().min(1).max(200);
const sourceSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

export const connectionInputSchema = z.object({
  sessionId: sessionIdSchema,
  status: z.enum(CONNECTION_STATES),
  checkedAt: z.date().optional(),
});

export type ConnectionInput = z.input<typeof connectionInputSchema>;

export const connectionStatusInputSchema = z.object({
  status: z.enum(CONNECTION_STATES),
  checkedAt: z.date().optional(),
});

export const inboundMessageSchema = z
  .object({
    kind: z.literal("inbound_message"),
    eventId: eventIdSchema,
    sessionId: sessionIdSchema,
    externalId: z.string().min(1).max(200),
    from: z.string().refine(isNormalizedPhone),
    profileName: z.string().nullable(),
    text: z.string().min(1).nullable(),
    mediaType: z.enum(MEDIA_TYPES).nullable(),
    receivedAt: z.date(),
  })
  .refine((message) => message.text !== null || message.mediaType !== null);

export const deliveryStatusSchema = z.object({
  kind: z.literal("delivery_status"),
  eventId: eventIdSchema,
  sessionId: sessionIdSchema,
  externalId: z.string().min(1).max(200),
  state: z.enum(DELIVERY_STATES),
  at: z.date(),
});

export const connectionStatusSchema = z.object({
  kind: z.literal("connection_status"),
  eventId: eventIdSchema,
  sessionId: sessionIdSchema,
  state: z.enum(CONNECTION_STATES),
  reason: z.string().nullable(),
  at: z.date(),
});

export const webhookEventSchema = z.object({
  source: sourceSchema,
  event: z.discriminatedUnion("kind", [inboundMessageSchema, deliveryStatusSchema, connectionStatusSchema]),
});
