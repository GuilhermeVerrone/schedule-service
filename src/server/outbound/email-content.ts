import type { OutboundMessageType } from "./message-types";

// Assunto do e-mail de reserva (Fase 8), por tipo da lista fechada (D16). Fica no código: o
// template editável do dono (D5) é o corpo, igual ao do WhatsApp, em texto puro. O nome do
// negócio vai sem quebra de linha (cabeçalho).

const SUBJECTS: Record<OutboundMessageType, (business: string) => string> = {
  appointment_confirmation: (business) => `Agendamento confirmado - ${business}`,
  optout_confirmation: (business) => `Você não vai mais receber mensagens de ${business}`,
};

export function emailSubject(type: OutboundMessageType, business: string): string {
  const name = business.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return SUBJECTS[type](name).slice(0, 200);
}
