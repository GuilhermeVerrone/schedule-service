import { NextResponse } from "next/server";
import { workingHoursDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { weeklyScheduleBodySchema, workingHoursBodySchema } from "@/server/validation/catalog";

type Params = { id: string };

// GET /api/professionals/:id/working-hours: grade semanal, por dia e início.
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const intervals = found(await repo.workingHours.list(params.id), NOT_FOUND.professional);
  return NextResponse.json({ workingHours: intervals.map(workingHoursDto) });
});

// POST /api/professionals/:id/working-hours { weekday, start, end }: um intervalo novo.
export const POST = tenantRoute<Params>(async ({ request, repo, params }) => {
  const input = await parseBody(request, workingHoursBodySchema);
  const interval = found(await repo.workingHours.create(params.id, input), NOT_FOUND.professional);
  return NextResponse.json({ workingHours: workingHoursDto(interval) }, { status: 201 });
});

// PUT /api/professionals/:id/working-hours { intervals }: substitui a grade inteira numa transação.
export const PUT = tenantRoute<Params>(async ({ request, repo, params }) => {
  const { intervals } = await parseBody(request, weeklyScheduleBodySchema);
  const saved = found(await repo.workingHours.replaceAll(params.id, intervals), NOT_FOUND.professional);
  return NextResponse.json({ workingHours: saved.map(workingHoursDto) });
});
