import { NextResponse } from "next/server";
import { serviceDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { serviceUpdateSchema } from "@/server/validation/catalog";

type Params = { id: string };

// GET /api/services/:id (inclusive arquivado)
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const service = found(await repo.services.findById(params.id), NOT_FOUND.service);
  return NextResponse.json({ service: serviceDto(service) });
});

// PATCH /api/services/:id { name?, durationMinutes?, priceCents? }
export const PATCH = tenantRoute<Params>(async ({ request, repo, params }) => {
  const input = await parseBody(request, serviceUpdateSchema);
  const service = found(await repo.services.update(params.id, input), NOT_FOUND.service);
  return NextResponse.json({ service: serviceDto(service) });
});
