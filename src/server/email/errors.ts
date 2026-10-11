// Erro único do adapter de e-mail. A mensagem nunca leva segredo (chave do provedor) nem
// conteúdo ou destinatário do e-mail: pode ir para log.

export type EmailErrorCode =
  // Configuração ausente ou inválida (provedor, chave, domínio de envio).
  | "misconfigured"
  // O provedor recusou o destinatário ou o conteúdo: tentar de novo não adianta.
  | "rejected"
  // A chave de idempotência já foi usada com outro conteúdo: o e-mail pode já ter saído.
  | "duplicate_request"
  // Fora do ar, limite de taxa, tempo esgotado ou erro 5xx: vale tentar de novo.
  | "provider_unavailable";

export class EmailProviderError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmailProviderError";
  }

  // Tentar de novo pode dar certo (retentativa da fila, D10).
  get retryable(): boolean {
    return this.code === "provider_unavailable" || this.code === "misconfigured";
  }
}

export const isEmailError = (error: unknown, code?: EmailErrorCode): error is EmailProviderError =>
  error instanceof EmailProviderError && (code === undefined || error.code === code);
