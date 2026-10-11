import { NextResponse } from "next/server";
import { blockedMessageDto, NO_STORE_HEADERS, pageDto } from "@/server/http/serializers";
import { parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { pageQuerySchema } from "@/server/validation/whatsapp-api";

// GET /api/whatsapp/blocked?page=N: envios bloqueados do tenant com o motivo, mais recente
// primeiro, 50 por página (guia 7b, 7f; D6, D8). Somente leitura.
export const GET = tenantRoute(async ({ request, repo }) => {
  const { page } = parseQuery(request, pageQuerySchema);
  const blocked = await repo.outboundMessages.listBlocked(page);
  return NextResponse.json({ blocked: pageDto(blocked, blockedMessageDto) }, { headers: NO_STORE_HEADERS });
});
