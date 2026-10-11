import { NextResponse } from "next/server";
import { disconnectWhatsApp } from "@/server/messaging/connection";
import { NO_STORE_HEADERS, whatsappConnectionDto } from "@/server/http/serializers";
import { tenantRoute } from "@/server/http/tenant-route";
import { getWhatsAppProvider } from "@/server/whatsapp";

// POST /api/whatsapp/disconnect (sem corpo): encerra a sessão no provedor (jornada 7e). Sem
// conexão: 404; repetir devolve "disconnected".
export const POST = tenantRoute(async ({ repo }) => {
  const connection = await disconnectWhatsApp(repo, getWhatsAppProvider());
  return NextResponse.json({ connection: whatsappConnectionDto(connection) }, { headers: NO_STORE_HEADERS });
});
