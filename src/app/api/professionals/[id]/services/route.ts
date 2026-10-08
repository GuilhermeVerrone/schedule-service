import { NextResponse } from "next/server";
import { serviceDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { serviceIdsSchema } from "@/server/validation/catalog";

type Params = { id: string };

// GET /api/professionals/:id/services: serviços vinculados (N:N, D5).
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const services = found(await repo.professionalServices.listServices(params.id), NOT_FOUND.professional);
  return NextResponse.json({ services: services.map(serviceDto) });
});

// PUT /api/professionals/:id/services { serviceIds }: substitui todos os vínculos.
// Se algum id não for do tenant, nada muda (404).
export const PUT = tenantRoute<Params>(async ({ request, repo, params }) => {
  const { serviceIds } = await parseBody(request, serviceIdsSchema);
  found(await repo.professionalServices.setServices(params.id, serviceIds), NOT_FOUND.link);
  const services = found(await repo.professionalServices.listServices(params.id), NOT_FOUND.professional);
  return NextResponse.json({ services: services.map(serviceDto) });
});
