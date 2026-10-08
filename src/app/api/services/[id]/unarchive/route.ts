import { NextResponse } from "next/server";
import { serviceDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// POST /api/services/:id/unarchive
export const POST = tenantRoute<{ id: string }>(async ({ repo, params }) => {
  const service = found(await repo.services.unarchive(params.id), NOT_FOUND.service);
  return NextResponse.json({ service: serviceDto(service) });
});
