import { NextResponse } from "next/server";
import { connectWhatsApp } from "@/server/messaging/connection";
import { NO_STORE_HEADERS, whatsappConnectionDto } from "@/server/http/serializers";
import { tenantRoute } from "@/server/http/tenant-route";
import { getWhatsAppProvider } from "@/server/whatsapp";

// POST /api/whatsapp/connect (sem corpo): abre a sessão do tenant e devolve o QR a ler (jornada 7a).
// Depois de desconectar, gera um QR novo. Já conectado: 409.
export const POST = tenantRoute(async ({ repo }) => {
  const connection = await connectWhatsApp(repo, getWhatsAppProvider());
  return NextResponse.json({ connection: whatsappConnectionDto(connection) }, { headers: NO_STORE_HEADERS });
});
