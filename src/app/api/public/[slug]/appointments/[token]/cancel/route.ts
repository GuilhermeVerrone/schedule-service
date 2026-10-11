import { NextResponse } from "next/server";
import { cancelByToken, manageState } from "@/server/agenda/public-booking";
import { publicAppointmentDto } from "@/server/http/serializers";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found } from "@/server/http/tenant-route";

// POST /api/public/:slug/appointments/:token/cancel: cancela até o prazo do negócio (D6).
// Depois do prazo: 409 deadline_passed. Cancelar de novo devolve o mesmo.
export const POST = publicRoute<{ slug: string; token: string }>("write", async ({ repo, tenant, params }) => {
  const appointment = found(await cancelByToken(repo, params.token), PUBLIC_NOT_FOUND.appointment);
  return NextResponse.json({ appointment: publicAppointmentDto(appointment, manageState(appointment, tenant.business, new Date())) });
});
