import { NextResponse } from "next/server";
import { conversationDto, messageDto, NO_STORE_HEADERS, pageDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { pageQuerySchema } from "@/server/validation/whatsapp-api";

// GET /api/conversations/{id}/messages?page=N: a conversa e as mensagens dela, 50 por página, mais
// recentes primeiro (jornada 7d; D6, D7). Conversa de outro tenant: 404, como inexistente.
export const GET = tenantRoute<{ id: string }>(async ({ request, repo, params }) => {
  const { page } = parseQuery(request, pageQuerySchema);
  const conversation = found(await repo.conversations.findById(params.id), NOT_FOUND.conversation);
  const messages = found(await repo.messages.listByConversation(conversation.id, page), NOT_FOUND.conversation);
  return NextResponse.json(
    { conversation: conversationDto(conversation), messages: pageDto(messages, messageDto) },
    { headers: NO_STORE_HEADERS },
  );
});
