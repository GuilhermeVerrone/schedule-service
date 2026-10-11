import type { Contact, Conversation, Message } from "@/generated/prisma/client";
import { pageSchema, WHATSAPP_PAGE_SIZE } from "@/server/validation/whatsapp";
import { byId, type TenantScope } from "../shared";

// Conversas do tenant (guia 5; D6, D7): somente leitura, mais recente primeiro, 50 por página.

export type ConversationContact = Pick<Contact, "id" | "name" | "phone">;
export type LastMessage = Pick<Message, "id" | "direction" | "body" | "mediaType" | "sentAt">;

export interface ConversationSummary extends Pick<Conversation, "id" | "lastMessageAt"> {
  contact: ConversationContact;
  lastMessage: LastMessage | null;
}

export interface ConversationDetails extends Pick<Conversation, "id" | "lastMessageAt" | "createdAt"> {
  contact: ConversationContact;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const contactFields = { id: true, name: true, phone: true } as const;
const lastMessageFields = { id: true, direction: true, body: true, mediaType: true, sentAt: true } as const;

export function createConversationsRepository({ tenantId, db }: TenantScope) {
  return {
    // Lê uma linha a mais para saber se há próxima página.
    async list(page?: number): Promise<Page<ConversationSummary>> {
      const current = pageSchema.parse(page);
      const rows = await db.conversation.findMany({
        where: { tenantId },
        select: {
          id: true,
          lastMessageAt: true,
          contact: { select: contactFields },
          messages: {
            where: { tenantId },
            select: lastMessageFields,
            orderBy: [{ sentAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        skip: (current - 1) * WHATSAPP_PAGE_SIZE,
        take: WHATSAPP_PAGE_SIZE + 1,
      });
      return {
        items: rows.slice(0, WHATSAPP_PAGE_SIZE).map(({ messages, ...row }) => ({
          ...row,
          lastMessage: messages[0] ?? null,
        })),
        page: current,
        pageSize: WHATSAPP_PAGE_SIZE,
        hasMore: rows.length > WHATSAPP_PAGE_SIZE,
      };
    },

    findById(id: string): Promise<ConversationDetails | null> {
      return byId(id, () =>
        db.conversation.findFirst({
          where: { id, tenantId },
          select: { id: true, lastMessageAt: true, createdAt: true, contact: { select: contactFields } },
        }),
      );
    },
  };
}
