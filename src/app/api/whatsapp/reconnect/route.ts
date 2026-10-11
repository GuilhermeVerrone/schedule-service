import { NextResponse } from "next/server";
import { reconnectWhatsApp } from "@/server/messaging/connection";
import { NO_STORE_HEADERS, whatsappConnectionDto } from "@/server/http/serializers";
import { tenantRoute } from "@/server/http/tenant-route";
import { getWhatsAppProvider } from "@/server/whatsapp";

// POST /api/whatsapp/reconnect (sem corpo): depois de uma queda, retoma a sessão com um QR novo
// (jornada 7b). Sem conexão: 404; já conectado: 409.
export const POST = tenantRoute(async ({ repo }) => {
  const connection = await reconnectWhatsApp(repo, getWhatsAppProvider());
  return NextResponse.json({ connection: whatsappConnectionDto(connection) }, { headers: NO_STORE_HEADERS });
});
