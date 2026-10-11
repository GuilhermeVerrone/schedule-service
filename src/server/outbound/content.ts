import { DateTime } from "luxon";
import type { TenantRepository } from "@/server/repositories/tenant-repository";
import type { OutboundMessageType } from "./message-types";
import { renderTemplate, type TemplateVariables } from "./templates";

// Valores das variáveis do template, lidos do banco no worker (o payload do job só tem ids).
// Assunto que sumiu ou mudou (agendamento cancelado antes do envio) vira bloqueio com motivo.

export type ContentBlockReason = "contact_not_found" | "tenant_not_found" | "appointment_not_found" | "appointment_not_confirmed";

export type MessageContent =
  // `render` monta o texto final de uma variação com as variáveis do tipo (texto puro).
  | { ok: true; phone: string; render: (text: string) => string }
  | { ok: false; reason: ContentBlockReason };

type ContentRepo = Pick<TenantRepository, "tenant" | "contacts" | "appointments">;

// Nome do contato como está no cadastro; vazio (não deveria ocorrer, o cadastro exige 2+
// caracteres) vira "cliente".
const displayName = (name: string): string => name.trim() || "cliente";

export async function buildMessageContent(
  repo: ContentRepo,
  type: OutboundMessageType,
  contactId: string,
  appointmentId: string | null,
): Promise<MessageContent> {
  const [tenant, contact] = await Promise.all([repo.tenant.get(), repo.contacts.findById(contactId)]);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!contact) return { ok: false, reason: "contact_not_found" };
  const base = { nome: displayName(contact.name), negocio: tenant.name };

  if (type === "optout_confirmation") {
    const variables: TemplateVariables<"optout_confirmation"> = base;
    return { ok: true, phone: contact.phone, render: (text) => renderTemplate(text, variables) };
  }

  const appointment = appointmentId ? await repo.appointments.findById(appointmentId) : null;
  if (!appointment || appointment.contactId !== contactId) return { ok: false, reason: "appointment_not_found" };
  if (appointment.status !== "confirmed") return { ok: false, reason: "appointment_not_confirmed" };
  const startsAt = DateTime.fromJSDate(appointment.startsAt, { zone: tenant.timezone });
  const variables: TemplateVariables<"appointment_confirmation"> = {
    ...base,
    servico: appointment.service.name,
    profissional: appointment.professional.name,
    data: startsAt.toFormat("dd/MM/yyyy"),
    hora: startsAt.toFormat("HH:mm"),
  };
  return { ok: true, phone: contact.phone, render: (text) => renderTemplate(text, variables) };
}
