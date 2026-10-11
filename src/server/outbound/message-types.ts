// Tipos de mensagem do sistema (D16): lista fechada, sem tipo livre (regra inegociável: sem
// campanhas). Igual ao CHECK de `outbound_messages.message_type` e `message_templates.message_type`.
// Lembretes e cobranças entram nas Fatias 5 a 7.
export const OUTBOUND_MESSAGE_TYPES = ["appointment_confirmation", "optout_confirmation"] as const;

export type OutboundMessageType = (typeof OUTBOUND_MESSAGE_TYPES)[number];
