import { EmailProviderError } from "./errors";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

// Provedor real de e-mail: Resend (premissa de decisoes.md, "sugestão: Resend, a confirmar").
// Único arquivo do projeto que fala com o Resend: o produto usa só EmailProvider. A chave
// (RESEND_API_KEY) só vai no header; nunca em log nem em mensagem de erro.
// API: POST https://api.resend.com/emails, Bearer, corpo { from, to[], subject, text } e o
// header Idempotency-Key (24 h no Resend), resposta { id }.

export const RESEND_SOURCE = "resend";
export const RESEND_API_URL = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;

export interface ResendOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class ResendEmailProvider implements EmailProvider {
  readonly source = RESEND_SOURCE;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: ResendOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = this.options.apiKey.trim();
    if (!apiKey) throw new EmailProviderError("misconfigured", "RESEND_API_KEY não definida.");

    let response: Response;
    try {
      response = await this.fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? RESEND_TIMEOUT_MS),
      });
    } catch {
      throw new EmailProviderError("provider_unavailable", "Resend fora do ar ou sem resposta.");
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof body?.id !== "string" || !body.id) {
        throw new EmailProviderError("provider_unavailable", "Resposta do Resend sem id.");
      }
      return { externalId: body.id };
    }
    throw await toError(response);
  }
}

// Só o código do erro do Resend (`name`) entra na mensagem: o corpo pode repetir o destinatário.
async function toError(response: Response): Promise<EmailProviderError> {
  const body = (await response.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.replace(/[^a-z_]/g, "").slice(0, 64) : "";
  const detail = `Resend respondeu ${response.status}${name ? ` (${name})` : ""}.`;
  if (response.status === 401 || response.status === 403) return new EmailProviderError("misconfigured", detail);
  // 409: a mesma chave com outro conteúdo (o e-mail pode já ter saído) ou outra requisição com a
  // mesma chave ainda em andamento (essa pode ser repetida).
  if (response.status === 409) {
    return name === "concurrent_idempotent_requests"
      ? new EmailProviderError("provider_unavailable", detail)
      : new EmailProviderError("duplicate_request", detail);
  }
  if (response.status === 429 || response.status >= 500) return new EmailProviderError("provider_unavailable", detail);
  return new EmailProviderError("rejected", detail);
}
