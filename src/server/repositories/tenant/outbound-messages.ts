import type { Contact, OutboundMessage } from "@/generated/prisma/client";
import type { OutboundMessageType } from "@/server/outbound/message-types";
import { pageSchema, WHATSAPP_PAGE_SIZE } from "@/server/validation/whatsapp";
import { byId, contactExists, isId, type TenantScope } from "../shared";
import type { Page } from "./conversations";

// Registro de envios do tenant (guia 5; D7, D10, D12). Cada linha nasce `queued` pela chave de
// idempotência (única por tenant) e só sai de `queued` uma vez: toda transição tem `status:
// "queued"` no próprio UPDATE, então dois jobs do mesmo envio nunca registram dois desfechos.
// O texto enviado não fica aqui; vai para `messages`, na conversa do contato (LGPD, impacto).

export interface OutboundCreateInput {
  contactId: string;
  messageType: OutboundMessageType;
  idempotencyKey: string;
  // Quando deveria sair (base da expiração de 24 h, D7).
  scheduledFor: Date;
}

interface SentCommon {
  externalId: string;
  sentAt: Date;
  templateVariant: number;
}

export type OutboundSentInput =
  | (SentCommon & {
      channel: "whatsapp";
      // Texto montado, gravado só na conversa.
      body: string;
      // Estado devolvido pelo provedor (`messages.status`).
      deliveryState: "pending" | "sent";
    })
  // Fallback por e-mail (Fase 8): a conversa é a do WhatsApp, então o e-mail não entra nela.
  | (SentCommon & { channel: "email" });

// Envio bloqueado visto pelo painel (D6, D8): motivo e contato, sem chave de idempotência nem id
// externo. O momento do bloqueio é o `updated_at` (a linha só sai de `queued` uma vez).
export interface BlockedMessage extends Pick<OutboundMessage, "id" | "messageType" | "channel" | "blockReason" | "scheduledFor" | "createdAt"> {
  blockedAt: Date;
  contact: Pick<Contact, "id" | "name" | "phone">;
}

export function createOutboundMessagesRepository({ tenantId, db }: TenantScope) {
  // Sai de `queued` para o desfecho; false se já tinha desfecho (ou não é do tenant).
  async function finish(id: string, data: Partial<Pick<OutboundMessage, "status" | "blockReason">>) {
    if (!isId(id)) return false;
    const { count } = await db.outboundMessage.updateMany({ where: { id, tenantId, status: "queued" }, data });
    return count > 0;
  }

  return {
    // Idempotente pela chave: o mesmo evento devolve a linha que já existe, com `created: false`.
    // Contato de outro tenant (ou ID malformado): null.
    async create(input: OutboundCreateInput): Promise<{ message: OutboundMessage; created: boolean } | null> {
      if (!(await contactExists({ tenantId, db }, input.contactId))) return null;
      const { count } = await db.outboundMessage.createMany({
        data: {
          tenantId,
          contactId: input.contactId,
          messageType: input.messageType,
          idempotencyKey: input.idempotencyKey,
          scheduledFor: input.scheduledFor,
        },
        skipDuplicates: true,
      });
      const message = await db.outboundMessage.findUniqueOrThrow({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
      });
      return { message, created: count > 0 };
    },

    findById(id: string): Promise<OutboundMessage | null> {
      return byId(id, () => db.outboundMessage.findFirst({ where: { id, tenantId } }));
    },

    // Bloqueios do tenant, mais recente primeiro, 50 por página (lê uma linha a mais para saber
    // se há próxima página).
    async listBlocked(page?: number): Promise<Page<BlockedMessage>> {
      const current = pageSchema.parse(page);
      const rows = await db.outboundMessage.findMany({
        where: { tenantId, status: "blocked" },
        select: {
          id: true,
          messageType: true,
          channel: true,
          blockReason: true,
          scheduledFor: true,
          createdAt: true,
          updatedAt: true,
          contact: { select: { id: true, name: true, phone: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (current - 1) * WHATSAPP_PAGE_SIZE,
        take: WHATSAPP_PAGE_SIZE + 1,
      });
      return {
        items: rows.slice(0, WHATSAPP_PAGE_SIZE).map(({ updatedAt, ...row }) => ({ ...row, blockedAt: updatedAt })),
        page: current,
        pageSize: WHATSAPP_PAGE_SIZE,
        hasMore: rows.length > WHATSAPP_PAGE_SIZE,
      };
    },

    findByKey(idempotencyKey: string): Promise<OutboundMessage | null> {
      return db.outboundMessage.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    },

    markBlocked(id: string, reason: string): Promise<boolean> {
      return finish(id, { status: "blocked", blockReason: reason });
    },

    markExpired(id: string): Promise<boolean> {
      return finish(id, { status: "expired" });
    },

    // Falha final (D10) ou fila fora do ar (D12): visível como `failed`, nunca silenciosa.
    markFailed(id: string): Promise<boolean> {
      return finish(id, { status: "failed" });
    },

    // Envio concluído: marca `sent` e, no WhatsApp, grava a mensagem na conversa do contato
    // (direction `outbound`), numa transação. Se a linha já tinha desfecho, nada é gravado (false).
    async markSent(id: string, input: OutboundSentInput): Promise<boolean> {
      if (!isId(id)) return false;
      return db.$transaction(async (tx) => {
        const { count } = await tx.outboundMessage.updateMany({
          where: { id, tenantId, status: "queued" },
          data: {
            status: "sent",
            channel: input.channel,
            externalId: input.externalId,
            sentAt: input.sentAt,
            templateVariant: input.templateVariant,
          },
        });
        if (count === 0) return false;
        const { contactId, messageType } = await tx.outboundMessage.findUniqueOrThrow({
          where: { tenantId_id: { tenantId, id } },
          select: { contactId: true, messageType: true },
        });
        // Confirmação de opt-out enviada: marcador para nunca repetir (D15).
        if (messageType === "optout_confirmation") {
          await tx.contact.updateMany({
            where: { id: contactId, tenantId, optOutConfirmationSentAt: null },
            data: { optOutConfirmationSentAt: input.sentAt },
          });
        }
        if (input.channel !== "whatsapp") return true;
        const conversation = await tx.conversation.upsert({
          where: { tenantId_contactId: { tenantId, contactId } },
          create: { tenantId, contactId, lastMessageAt: input.sentAt },
          update: {},
          select: { id: true },
        });
        await tx.conversation.updateMany({
          where: {
            id: conversation.id,
            tenantId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: input.sentAt } }],
          },
          data: { lastMessageAt: input.sentAt },
        });
        await tx.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            direction: "outbound",
            status: input.deliveryState,
            body: input.body,
            externalId: input.externalId,
            sentAt: input.sentAt,
          },
        });
        return true;
      });
    },
  };
}
