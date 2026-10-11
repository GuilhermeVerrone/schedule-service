import { NextResponse } from "next/server";
import { appointmentDto } from "@/server/http/serializers";
import { found, NOT_FOUND, tenantRoute } from "@/server/http/tenant-route";

// POST /api/appointments/:id/cancel: libera o horário (D4). Cancelar de novo devolve o mesmo;
// concluído não cancela (409 invalid_status). O dono não tem prazo de cancelamento.
export const POST = tenantRoute<{ id: string }>(async ({ repo, params }) => {
  const appointment = found(await repo.appointments.cancel(params.id), NOT_FOUND.appointment);
  return NextResponse.json({ appointment: appointmentDto(appointment) });
});
