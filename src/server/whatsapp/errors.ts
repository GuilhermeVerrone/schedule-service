// Erro único do adapter. A mensagem nunca leva segredo (chave do provedor, token) nem conteúdo
// de mensagem: pode ir para log.

export type WhatsAppErrorCode =
  | "unknown_session"
  | "not_connected"
  | "invalid_phone"
  | "invalid_payload"
  | "provider_unavailable"
  | "not_implemented"
  | "misconfigured";

export class WhatsAppProviderError extends Error {
  constructor(
    readonly code: WhatsAppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

export const isWhatsAppError = (error: unknown, code?: WhatsAppErrorCode): error is WhatsAppProviderError =>
  error instanceof WhatsAppProviderError && (code === undefined || error.code === code);
