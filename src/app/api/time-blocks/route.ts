import { NextResponse } from "next/server";
import { timeBlockDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { rangeQuerySchema, timeBlockCreateSchema } from "@/server/validation/agenda-api";

// GET /api/time-blocks?from=ISO&to=ISO[&professionalId]: bloqueios que cruzam o intervalo.
export const GET = tenantRoute(async ({ request, repo }) => {
  const query = parseQuery(request, rangeQuerySchema);
  const blocks = await repo.timeBlocks.listRange({
    startsAt: query.from,
    endsAt: query.to,
    professionalId: query.professionalId,
  });
  return NextResponse.json({ timeBlocks: blocks.map(timeBlockDto) });
});

// POST /api/time-blocks { professionalId, startsAt, endsAt, reason? }: bloqueio avulso (D9).
export const POST = tenantRoute(async ({ request, repo }) => {
  const { professionalId, ...input } = await parseBody(request, timeBlockCreateSchema);
  const block = found(await repo.timeBlocks.create(professionalId, input), NOT_FOUND.professional);
  return NextResponse.json({ timeBlock: timeBlockDto(block) }, { status: 201 });
});
