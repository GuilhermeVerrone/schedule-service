import { NextResponse } from "next/server";
import { getSendUsage } from "@/server/outbound/usage";
import { NO_STORE_HEADERS, sendUsageDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// GET /api/whatsapp/usage: uso de hoje ("42 de 200") e fase do aquecimento do número do tenant
// (guia 3, 7f; D3, D6, D9, D14). Somente leitura; sem conexão, `configured: false` e uso zero.
export const GET = tenantRoute(async ({ repo }) => {
  const usage = found(await getSendUsage(repo), NOT_FOUND.business);
  return NextResponse.json({ usage: sendUsageDto(usage) }, { headers: NO_STORE_HEADERS });
});
