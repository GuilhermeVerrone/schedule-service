import { NextResponse } from "next/server";
import { appointmentDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// POST /api/appointments/:id/complete: o dono marca como concluído (D4). Cancelado: 409 invalid_status.
export const POST = tenantRoute<{ id: string }>(async ({ repo, params }) => {
  const appointment = found(await repo.appointments.complete(params.id), NOT_FOUND.appointment);
  return NextResponse.json({ appointment: appointmentDto(appointment) });
});
