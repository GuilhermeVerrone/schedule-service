import { NextResponse } from "next/server";
import { professionalDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// POST /api/professionals/:id/archive: profissional não é apagado, só arquivado (D6).
export const POST = tenantRoute<{ id: string }>(async ({ repo, params }) => {
  const professional = found(await repo.professionals.archive(params.id), NOT_FOUND.professional);
  return NextResponse.json({ professional: professionalDto(professional) });
});
