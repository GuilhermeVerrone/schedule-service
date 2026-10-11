import { NextResponse } from "next/server";
import { rescheduleAppointment } from "@/server/agenda/booking";
import { appointmentDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, tenantRoute } from "@/server/http/tenant-route";
import { rescheduleSchema } from "@/server/validation/agenda-api";

// POST /api/appointments/:id/reschedule { startsAt, professionalId? }: mesmo registro, mesma
// duração; horário ocupado ou fora da agenda é 409 e nada muda.
export const POST = tenantRoute<{ id: string }>(async ({ request, repo, params }) => {
  const input = await parseBody(request, rescheduleSchema);
  const appointment = found(await rescheduleAppointment(repo, params.id, input), NOT_FOUND.appointment);
  return NextResponse.json({ appointment: appointmentDto(appointment) });
});
