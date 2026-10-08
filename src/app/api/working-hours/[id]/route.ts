import { NextResponse } from "next/server";
import { workingHoursDto } from "@/server/http/serializers";
import { found, noContent, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { workingHoursBodySchema } from "@/server/validation/catalog";

type Params = { id: string };

// PATCH /api/working-hours/:id { weekday, start, end }: troca o intervalo inteiro.
export const PATCH = tenantRoute<Params>(async ({ request, repo, params }) => {
  const input = await parseBody(request, workingHoursBodySchema);
  const interval = found(await repo.workingHours.update(params.id, input), NOT_FOUND.workingHours);
  return NextResponse.json({ workingHours: workingHoursDto(interval) });
});

// DELETE /api/working-hours/:id: horários são apagados de verdade (D6).
export const DELETE = tenantRoute<Params>(async ({ repo, params }) => {
  found(await repo.workingHours.delete(params.id), NOT_FOUND.workingHours);
  return noContent();
});
