// Contrato do e-mail transacional (Fase 8): canal de reserva quando o WhatsApp cai (guia 6, 7d;
// D8). O produto só conhece esta interface; o provedor concreto fica em src/server/email/.

export interface SendEmailInput {
  // "Nome" <local@dominio>, montado por `fromAddress` com EMAIL_FROM_DOMAIN.
  from: string;
  to: string;
  subject: string;
  // Texto puro (o template do dono nunca vira HTML).
  text: string;
  // Mesmo valor nas retentativas do mesmo envio: o provedor não envia duas vezes.
  idempotencyKey: string;
}

export interface SendEmailResult {
  // Id do e-mail no provedor (`outbound_messages.external_id`).
  externalId: string;
}

export interface EmailProvider {
  readonly source: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
