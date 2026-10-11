import { NextResponse } from "next/server";
import { timeBlockDto } from "@/server/http/serializers";
import { found, NOT_FOUND, noContent, tenantRoute } from "@/server/http/tenant-route";

type Params = { id: string };

// GET /api/time-blocks/:id
export const GET = tenantRoute<Params>(async ({ repo, params }) => {
  const block = found(await repo.timeBlocks.findById(params.id), NOT_FOUND.timeBlock);
  return NextResponse.json({ timeBlock: timeBlockDto(block) });
});

// DELETE /api/time-blocks/:id: remove de verdade e libera o horário.
export const DELETE = tenantRoute<Params>(async ({ repo, params }) => {
  found(await repo.timeBlocks.delete(params.id), NOT_FOUND.timeBlock);
  return noContent();
});
