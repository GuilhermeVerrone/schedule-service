import { found, noContent, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

type Params = { id: string; serviceId: string };

// PUT /api/professionals/:id/services/:serviceId: vincula (idempotente).
export const PUT = tenantRoute<Params>(async ({ repo, params }) => {
  found(await repo.professionalServices.link(params.id, params.serviceId), NOT_FOUND.link);
  return noContent();
});

// DELETE /api/professionals/:id/services/:serviceId: desvincula.
export const DELETE = tenantRoute<Params>(async ({ repo, params }) => {
  found(await repo.professionalServices.unlink(params.id, params.serviceId), NOT_FOUND.link);
  return noContent();
});
