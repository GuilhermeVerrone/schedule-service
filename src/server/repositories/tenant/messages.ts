import type { Message } from "@/generated/prisma/client";
import { pageSchema, WHATSAPP_PAGE_SIZE } from "@/server/validation/whatsapp";
import { isId, type TenantScope } from "../shared";
import type { Page } from "./conversations";

// Mensagens de uma conversa do tenant (D7): a página 1 traz as 50 mais recentes; a tela inverte
// para exibir em ordem cronológica. Mídia vem só como tipo.

export type MessageView = Pick<
  Message,
  "id" | "direction" | "body" | "mediaType" | "status" | "sentAt"
>;

const messageFields = {
  id: true,
  direction: true,
  body: true,
  mediaType: true,
  status: true,
  sentAt: true,
} as const;

export function createMessagesRepository({ tenantId, db }: TenantScope) {
  return {
    // Conversa de outro tenant (ou ID malformado) devolve null, sem revelar que existe.
    async listByConversation(conversationId: string, page?: number): Promise<Page<MessageView> | null> {
      const current = pageSchema.parse(page);
      if (!isId(conversationId)) return null;
      const exists = await db.conversation.count({ where: { id: conversationId, tenantId } });
      if (exists === 0) return null;

      const rows = await db.message.findMany({
        where: { tenantId, conversationId },
        select: messageFields,
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        skip: (current - 1) * WHATSAPP_PAGE_SIZE,
        take: WHATSAPP_PAGE_SIZE + 1,
      });
      return {
        items: rows.slice(0, WHATSAPP_PAGE_SIZE),
        page: current,
        pageSize: WHATSAPP_PAGE_SIZE,
        hasMore: rows.length > WHATSAPP_PAGE_SIZE,
      };
    },
  };
}
