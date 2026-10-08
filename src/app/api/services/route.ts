import { NextResponse } from "next/server";
import { serviceDto } from "@/server/http/serializers";
import { parseBody, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { listQuerySchema, serviceSchema } from "@/server/validation/catalog";

// GET /api/services[?includeArchived=true]: serviços do tenant, por nome.
export const GET = tenantRoute(async ({ request, repo }) => {
  const { includeArchived } = parseQuery(request, listQuerySchema);
  const services = await repo.services.list({ includeArchived });
  return NextResponse.json({ services: services.map(serviceDto) });
});

// POST /api/services { name, durationMinutes, priceCents }
export const POST = tenantRoute(async ({ request, repo }) => {
  const input = await parseBody(request, serviceSchema);
  const service = await repo.services.create(input);
  return NextResponse.json({ service: serviceDto(service) }, { status: 201 });
});
