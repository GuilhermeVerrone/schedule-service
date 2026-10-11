import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { parseOptOutCommand } from "@/server/messaging/opt-out";
import { webhookEventSchema } from "@/server/validation/whatsapp";
import type {
  ConnectionStatus,
  DeliveryState,
  DeliveryStatus,
  InboundMessage,
  WhatsAppEvent,
} from "@/server/whatsapp";

// Segunda entrada sem sessão, ao lado do public-repository (guia 6, D8): o webhook do provedor.
// O tenant vem só de WhatsAppConnection.sessionId, nunca de outro dado do corpo. Cada evento roda
// numa transação: grava o WebhookEvent (unicidade source + event_id, D3) e o efeito dele; se algo
// falhar, nada fica gravado e o reenvio do provedor processa de novo. Sessão desconhecida e evento
// repetido não gravam nada.

export type WebhookResult =
  // `optOutConfirmation`: o contato acabou de pedir opt-out e ainda não recebeu a confirmação
  // única (D15); quem chamou enfileira depois do commit.
  | { status: "processed"; tenantId: string; optOutConfirmation?: { contactId: string } }
  | { status: "duplicate" }
  | { status: "unknown_session" };

type Tx = Prisma.TransactionClient;

const CONTACT_NAME_MAX = 80;
const INBOUND_ORIGIN = "whatsapp_inbound";

// Estado anterior aceito para cada status de entrega: o status só avança (um "delivered" atrasado
// não desfaz um "read"), e falha só antes da entrega.
const PREVIOUS_STATES: Record<DeliveryState, string[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent"],
};

// Horário futuro vindo do provedor não pode estender a janela de 30 dias de elegibilidade.
const notAfterNow = (date: Date): Date => (date.getTime() > Date.now() ? new Date() : date);

// Nome do perfil do WhatsApp (D12) sem controles nem espaços repetidos, cortado no limite do
// cadastro; ausente ou curto demais, o telefone formatado.
export function contactNameFrom(profileName: string | null, phone: string): string {
  const cleaned = (profileName ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = [...cleaned].slice(0, CONTACT_NAME_MAX).join("").trim();
  return name.length >= 2 ? name : formatPhone(phone);
}

// Mensagem recebida: cria ou reencontra o contato pelo telefone (nome do perfil e origem
// `whatsapp_inbound` só na criação; consentimento nulo), aplica `SAIR`/`VOLTAR` (D4), atualiza
// last_inbound_at, a conversa e grava a mensagem (uma vez por id externo). Devolve o contato que
// precisa da confirmação de opt-out, se for o caso.
async function applyInboundMessage(
  tx: Tx,
  tenantId: string,
  event: InboundMessage,
): Promise<{ contactId: string } | undefined> {
  const at = notAfterNow(event.receivedAt);
  const contact = await tx.contact.upsert({
    where: { tenantId_phone: { tenantId, phone: event.from } },
    create: {
      tenantId,
      phone: event.from,
      name: contactNameFrom(event.profileName, event.from),
      consentSource: INBOUND_ORIGIN,
      lastInboundAt: at,
    },
    update: {},
    select: { id: true, lastInboundAt: true, optOutConfirmationSentAt: true },
  });

  // Efeito imediato, na mesma transação do evento. Mensagem mais antiga que a última recebida
  // (entregue fora de ordem) não desfaz um comando mais novo.
  const command = parseOptOutCommand(event.text);
  const isLatest = !contact.lastInboundAt || contact.lastInboundAt.getTime() <= at.getTime();
  if (command && isLatest) {
    await tx.contact.updateMany({
      where: { id: contact.id, tenantId },
      data: { optOut: command === "opt_out" },
    });
  }

  await tx.contact.updateMany({
    where: { id: contact.id, tenantId, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
    data: { lastInboundAt: at },
  });

  const conversation = await tx.conversation.upsert({
    where: { tenantId_contactId: { tenantId, contactId: contact.id } },
    create: { tenantId, contactId: contact.id, lastMessageAt: at },
    update: {},
    select: { id: true },
  });
  await tx.conversation.updateMany({
    where: { id: conversation.id, tenantId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
    data: { lastMessageAt: at },
  });

  // O mesmo id externo em outro evento (reenvio com id novo) não duplica a mensagem.
  await tx.message.createMany({
    data: {
      tenantId,
      conversationId: conversation.id,
      direction: "inbound",
      status: "received",
      body: event.text,
      mediaType: event.mediaType,
      externalId: event.externalId,
      sentAt: at,
    },
    skipDuplicates: true,
  });

  return command === "opt_out" && isLatest && !contact.optOutConfirmationSentAt
    ? { contactId: contact.id }
    : undefined;
}

async function applyDeliveryStatus(tx: Tx, tenantId: string, event: DeliveryStatus): Promise<void> {
  await tx.message.updateMany({
    where: {
      tenantId,
      externalId: event.externalId,
      direction: "outbound",
      status: { in: PREVIOUS_STATES[event.state] },
    },
    data: { status: event.state },
  });
}

// Evento de conexão mais antigo que a última checagem não sobrescreve o estado.
async function applyConnectionStatus(tx: Tx, tenantId: string, event: ConnectionStatus): Promise<void> {
  await tx.whatsAppConnection.updateMany({
    where: {
      tenantId,
      sessionId: event.sessionId,
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: event.at } }],
    },
    data: { status: event.state, lastCheckedAt: notAfterNow(event.at) },
  });
}

export function createWhatsAppWebhookRepository(db: PrismaClient = prisma) {
  // Interno do servidor: o tenantId nunca vai para a resposta do webhook.
  async function resolveTenantId(sessionId: string): Promise<string | null> {
    if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 200) return null;
    const connection = await db.whatsAppConnection.findUnique({
      where: { sessionId },
      select: { tenantId: true },
    });
    return connection?.tenantId ?? null;
  }

  return {
    resolveTenantId,

    // `source` é o nome do provider (webhook_events.source). Evento fora do contrato: ZodError.
    async recordEvent(source: string, input: WhatsAppEvent): Promise<WebhookResult> {
      const { event } = webhookEventSchema.parse({ source, event: input });
      return db.$transaction(
        async (tx) => {
          const connection = await tx.whatsAppConnection.findUnique({
            where: { sessionId: event.sessionId },
            select: { tenantId: true },
          });
          if (!connection) return { status: "unknown_session" } as const;
          const { tenantId } = connection;

          // ON CONFLICT DO NOTHING: o repetido não aborta a transação, só não insere. Dois
          // reenvios simultâneos esperam um pelo outro no índice único.
          const { count } = await tx.webhookEvent.createMany({
            data: { tenantId, source, eventId: event.eventId, processedAt: new Date() },
            skipDuplicates: true,
          });
          if (count === 0) return { status: "duplicate" } as const;

          if (event.kind === "inbound_message") {
            const optOutConfirmation = await applyInboundMessage(tx, tenantId, event);
            return optOutConfirmation
              ? ({ status: "processed", tenantId, optOutConfirmation } as const)
              : ({ status: "processed", tenantId } as const);
          }
          if (event.kind === "delivery_status") await applyDeliveryStatus(tx, tenantId, event);
          else await applyConnectionStatus(tx, tenantId, event);
          return { status: "processed", tenantId } as const;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    },
  };
}

export type WhatsAppWebhookRepository = ReturnType<typeof createWhatsAppWebhookRepository>;
