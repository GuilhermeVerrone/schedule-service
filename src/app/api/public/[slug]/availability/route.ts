import { NextResponse } from "next/server";
import { getAvailableSlots } from "@/server/agenda/booking";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found, parseQuery } from "@/server/http/tenant-route";
import { publicAvailabilityQuerySchema } from "@/server/validation/public-api";

// GET /api/public/:slug/availability?serviceId&date=AAAA-MM-DD[&professionalId]: horários livres
// do dia com as regras do cliente (antecedência e janela). Só início e profissionais livres,
// sem dado de cliente nem de agendamento.
export const GET = publicRoute<{ slug: string }>("read", async ({ request, repo }) => {
  const query = parseQuery(request, publicAvailabilityQuerySchema);
  const slots = found(await getAvailableSlots(repo, query), PUBLIC_NOT_FOUND.link);
  return NextResponse.json({
    date: query.date,
    slots: slots.map((slot) => ({ startsAt: slot.startsAt, professionalIds: slot.professionalIds })),
  });
});
