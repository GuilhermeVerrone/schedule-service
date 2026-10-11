import { NextResponse } from "next/server";
import { conversationSummaryDto, NO_STORE_HEADERS, pageDto } from "@/server/http/serializers";
import { parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { pageQuerySchema } from "@/server/validation/whatsapp-api";

// GET /api/conversations?page=N: conversas do tenant, mais recente primeiro, 50 por página
// (jornada 7d; D6, D7). Somente leitura.
export const GET = tenantRoute(async ({ request, repo }) => {
  const { page } = parseQuery(request, pageQuerySchema);
  const conversations = await repo.conversations.list(page);
  return NextResponse.json(
    { conversations: pageDto(conversations, conversationSummaryDto) },
    { headers: NO_STORE_HEADERS },
  );
});
