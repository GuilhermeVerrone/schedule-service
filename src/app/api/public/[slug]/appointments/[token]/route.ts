import { NextResponse } from "next/server";
import { findByManageToken, manageState } from "@/server/agenda/public-booking";
import { publicAppointmentDto } from "@/server/http/serializers";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found } from "@/server/http/tenant-route";

// GET /api/public/:slug/appointments/:token: o agendamento do link de gestão (guia 7c, D6).
// Token inválido, de outro negócio ou malformado: 404, sem distinguir os casos.
export const GET = publicRoute<{ slug: string; token: string }>("read", async ({ repo, tenant, params }) => {
  const appointment = found(await findByManageToken(repo, params.token), PUBLIC_NOT_FOUND.appointment);
  return NextResponse.json({ appointment: publicAppointmentDto(appointment, manageState(appointment, tenant.business, new Date())) });
});
