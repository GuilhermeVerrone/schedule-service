import { NextResponse } from "next/server";
import { messageTemplateDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { templateUpdateSchema } from "@/server/validation/outbound-api";

type Params = { id: string };

// GET /api/message-templates/:id
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const template = found(await repo.messageTemplates.findById(params.id), NOT_FOUND.template);
  return NextResponse.json({ template: messageTemplateDto(template) });
});

// PATCH /api/message-templates/:id { variations }: troca as variações (D5). O tipo não muda.
// Variação inválida: 400 `invalid_template` com a lista de problemas por posição.
export const PATCH = tenantRoute<Params>(async ({ request, repo, params }) => {
  const { variations } = await parseBody(request, templateUpdateSchema);
  const template = found(await repo.messageTemplates.updateVariations(params.id, variations), NOT_FOUND.template);
  return NextResponse.json({ template: messageTemplateDto(template) });
});
