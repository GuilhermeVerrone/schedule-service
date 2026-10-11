import { NextResponse } from "next/server";
import { createManualAppointment } from "@/server/agenda/booking";
import { appointmentDto } from "@/server/http/serializers";
import { found, NOT_FOUND, parseBody, parseQuery, tenantRoute } from "@/server/http/tenant-route";
import { appointmentCreateSchema, appointmentListQuerySchema } from "@/server/validation/agenda-api";

// GET /api/appointments?from=ISO&to=ISO[&professionalId][&status]: agenda que cruza o intervalo
// (dia ou semana no painel, D9), por início. Todos os status, salvo filtro.
export const GET = tenantRoute(async ({ request, repo }) => {
  const query = parseQuery(request, appointmentListQuerySchema);
  const appointments = await repo.appointments.listRange({
    startsAt: query.from,
    endsAt: query.to,
    professionalId: query.professionalId,
    statuses: query.status ? [query.status] : undefined,
  });
  return NextResponse.json({ appointments: appointments.map(appointmentDto) });
});

// POST /api/appointments { professionalId, serviceId, startsAt, contact: { name, phone, email? } }:
// agendamento manual do dono. Horário ocupado ou fora da agenda: 409.
export const POST = tenantRoute(async ({ request, repo }) => {
  const input = await parseBody(request, appointmentCreateSchema);
  const appointment = found(await createManualAppointment(repo, input), NOT_FOUND.link);
  return NextResponse.json({ appointment: appointmentDto(appointment) }, { status: 201 });
});
