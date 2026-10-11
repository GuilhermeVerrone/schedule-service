// Texto dos códigos que a API devolve crus (Fase 9, pendência 4): motivo do bloqueio, tipo de
// mensagem e canal. Código desconhecido (motivo novo de uma fatia futura) cai num texto genérico,
// nunca no código cru.

const REASONS: Record<string, string> = {
  opt_out: "O cliente pediu para não receber mensagens.",
  not_eligible: "O cliente não escreveu nos últimos 30 dias, não tem agendamento ativo nem consentimento registrado.",
  no_channel: "O WhatsApp estava fora do ar e o cliente não tem e-mail cadastrado.",
  template_inactive: "O texto deste tipo de mensagem está desligado.",
  contact_not_found: "O cliente não foi encontrado.",
  tenant_not_found: "O negócio não foi encontrado.",
  appointment_not_found: "O agendamento não foi encontrado.",
  appointment_not_confirmed: "O agendamento não estava mais confirmado.",
  not_opted_out: "O cliente não tinha pedido para sair, então a confirmação não era necessária.",
  optout_confirmation_already_sent: "A confirmação de saída já tinha sido enviada antes.",
  unknown_message_type: "Tipo de mensagem não reconhecido.",
};

const MESSAGE_TYPES: Record<string, string> = {
  appointment_confirmation: "Confirmação de agendamento",
  optout_confirmation: "Confirmação de saída",
};

const CHANNELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
};

export const blockReasonLabel = (code: string | null): string =>
  (code && REASONS[code]) || "Bloqueado pelas regras de envio.";

export const messageTypeLabel = (code: string): string => MESSAGE_TYPES[code] ?? "Mensagem do sistema";

export const channelLabel = (code: string | null): string | null => (code ? (CHANNELS[code] ?? null) : null);
