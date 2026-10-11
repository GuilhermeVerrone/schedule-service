import { NextResponse } from "next/server";
import { createPublicAppointment, manageState } from "@/server/agenda/public-booking";
import { publicAppointmentDto } from "@/server/http/serializers";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found, parseBody } from "@/server/http/tenant-route";
import { publicBookingSchema } from "@/server/validation/public-api";

// POST /api/public/:slug/appointments { serviceId, professionalId?, startsAt, contact, consent: true }:
// agenda pelo site (guia 7a). O cliente é reencontrado pelo telefone normalizado e o consentimento
// fica registrado (D5). O token de gestão sai só nesta resposta (D6); o banco guarda o hash.
// Horário ocupado, na corrida ou fora das regras: 409 slot_unavailable.
export const POST = publicRoute<{ slug: string }>("write", async ({ request, repo, tenant }) => {
  const input = await parseBody(request, publicBookingSchema);
  const { appointment, token } = found(await createPublicAppointment(repo, input), PUBLIC_NOT_FOUND.link);
  const state = manageState(appointment, tenant.business, new Date());
  return NextResponse.json(
    {
      appointment: publicAppointmentDto(appointment, state),
      manageToken: token,
      managePath: `/${tenant.business.slug}/agendamento/${token}`,
    },
    { status: 201 },
  );
});
