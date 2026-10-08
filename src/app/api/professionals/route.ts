import { NextResponse } from "next/server";
import { professionalDto } from "@/server/http/serializers";
import { parseBody, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { listQuerySchema, professionalSchema } from "@/server/validation/catalog";

// GET /api/professionals[?includeArchived=true]: profissionais do tenant, por nome.
export const GET = tenantRoute(async ({ request, repo }) => {
  const { includeArchived } = parseQuery(request, listQuerySchema);
  const professionals = await repo.professionals.list({ includeArchived });
  return NextResponse.json({ professionals: professionals.map(professionalDto) });
});

// POST /api/professionals { name }
export const POST = tenantRoute(async ({ request, repo }) => {
  const input = await parseBody(request, professionalSchema);
  const professional = await repo.professionals.create(input);
  return NextResponse.json({ professional: professionalDto(professional) }, { status: 201 });
});
