import { NextResponse } from "next/server";
import { getAvailableSlots } from "@/server/agenda/booking";
import { found, NOT_FOUND, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { availabilityQuerySchema } from "@/server/validation/agenda-api";

// GET /api/availability?serviceId&date=AAAA-MM-DD[&professionalId]: horários livres do dia com os
// parâmetros atuais do tenant (D3). Sem profissional, "qualquer profissional" com quem está livre.
export const GET = tenantRoute(async ({ request, repo }) => {
  const query = parseQuery(request, availabilityQuerySchema);
  const slots = found(await getAvailableSlots(repo, query), NOT_FOUND.link);
  return NextResponse.json({ date: query.date, slots });
});
