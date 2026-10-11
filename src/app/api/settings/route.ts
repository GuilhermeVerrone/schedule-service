import { NextResponse } from "next/server";
import { found, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { settingsBodySchema } from "@/server/validation/agenda-api";

const NOT_FOUND_TENANT = "Negócio não encontrado.";

// GET /api/settings: dados do negócio (D2) e parâmetros da agenda (D3). Nome, slug e fuso só leitura.
export const GET = tenantRoute(async ({ repo }) => {
  const settings = found(await repo.settings.get(), NOT_FOUND_TENANT);
  return NextResponse.json({ settings });
});

// PATCH /api/settings { description?, address?, phone?, slotStepMinutes?, bufferMinutes?,
// minAdvanceMinutes?, maxWindowDays?, cancelDeadlineMinutes? }: campo desconhecido é 400.
export const PATCH = tenantRoute(async ({ request, repo }) => {
  const input = await parseBody(request, settingsBodySchema);
  const settings = found(await repo.settings.update(input), NOT_FOUND_TENANT);
  return NextResponse.json({ settings });
});
