import { NextResponse } from "next/server";
import { professionalDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { professionalUpdateSchema } from "@/server/validation/catalog";

type Params = { id: string };

// GET /api/professionals/:id (inclusive arquivado)
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const professional = found(await repo.professionals.findById(params.id), NOT_FOUND.professional);
  return NextResponse.json({ professional: professionalDto(professional) });
});

// PATCH /api/professionals/:id { name? }
export const PATCH = tenantRoute<Params>(async ({ request, repo, params }) => {
  const input = await parseBody(request, professionalUpdateSchema);
  const professional = found(await repo.professionals.update(params.id, input), NOT_FOUND.professional);
  return NextResponse.json({ professional: professionalDto(professional) });
});
