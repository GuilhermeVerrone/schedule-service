import { NextResponse } from "next/server";
import { messageTemplateDto } from "@/server/http/serializers";
import { tenantRoute } from "@/server/http/tenant-route";

// GET /api/message-templates: um template por tipo da lista fechada (D5, D16), na ordem dos tipos.
// Tipo que ainda não tem template nasce com o texto padrão. Não há criação nem exclusão: o tipo é
// do sistema; "apagar" é restaurar o padrão.
export const GET = tenantRoute(async ({ repo }) => {
  const templates = await repo.messageTemplates.list();
  return NextResponse.json({ templates: templates.map(messageTemplateDto) });
});
