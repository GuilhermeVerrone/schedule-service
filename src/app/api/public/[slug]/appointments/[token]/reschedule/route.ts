import { NextResponse } from "next/server";
import { manageState, rescheduleByToken } from "@/server/agenda/public-booking";
import { publicAppointmentDto } from "@/server/http/serializers";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found, parseBody } from "@/server/http/tenant-route";
import { publicRescheduleSchema } from "@/server/validation/public-api";

// POST /api/public/:slug/appointments/:token/reschedule { startsAt, professionalId? }: mesmo
// registro e mesmo link (D6), até o prazo do horário atual e com as regras do cliente no novo.
export const POST = publicRoute<{ slug: string; token: string }>("write", async ({ request, repo, tenant, params }) => {
  const input = await parseBody(request, publicRescheduleSchema);
  const appointment = found(await rescheduleByToken(repo, params.token, input), PUBLIC_NOT_FOUND.appointment);
  return NextResponse.json({ appointment: publicAppointmentDto(appointment, manageState(appointment, tenant.business, new Date())) });
});
