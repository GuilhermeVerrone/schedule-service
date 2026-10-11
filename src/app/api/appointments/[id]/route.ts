import { NextResponse } from "next/server";
import { appointmentDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// GET /api/appointments/:id
export const GET = tenantRoute<{ id: string }>(async ({ repo, params }) => {
  const appointment = found(await repo.appointments.findById(params.id), NOT_FOUND.appointment);
  return NextResponse.json({ appointment: appointmentDto(appointment) });
});
