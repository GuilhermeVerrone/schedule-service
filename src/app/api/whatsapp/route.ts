import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/server/messaging/connection";
import { NO_STORE_HEADERS, whatsappConnectionDto } from "@/server/http/serializers";
import { tenantRoute } from "@/server/http/tenant-route";
import { getWhatsAppProvider } from "@/server/whatsapp";

// GET /api/whatsapp: estado da conexão do tenant (guia 3, 7a, 7b), consultado no provedor e
// gravado como última checagem. Sem conexão: status "not_configured". O QR só vem em "qr_pending".
// Provedor fora do ar: o último estado gravado, com live = false.
export const GET = tenantRoute(async ({ repo }) => {
  const connection = await getConnectionStatus(repo, getWhatsAppProvider());
  return NextResponse.json({ connection: whatsappConnectionDto(connection) }, { headers: NO_STORE_HEADERS });
});
