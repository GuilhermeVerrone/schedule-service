import { NextResponse } from "next/server";
import { messageTemplateDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

type Params = { id: string };

// POST /api/message-templates/:id/restore: volta as variações ao texto padrão do tipo (D5).
export const POST = tenantRoute<Params>(async ({ repo, params }) => {
  const current = found(await repo.messageTemplates.findById(params.id), NOT_FOUND.template);
  const template = await repo.messageTemplates.restoreDefault(current.messageType);
  return NextResponse.json({ template: messageTemplateDto(template) });
});
