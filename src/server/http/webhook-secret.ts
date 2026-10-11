import { createHash, timingSafeEqual } from "node:crypto";

// Segredo do webhook do WhatsApp (D8): WHATSAPP_WEBHOOK_SECRET, comparado em tempo constante.
// Os dois lados viram SHA-256 antes da comparação, então nem o tamanho do segredo vaza pelo tempo
// de resposta. Sem segredo configurado (ou curto demais), nenhuma chamada passa.
//
// TODO(provedor) item 7 da lista do adapter: confirmar como o provedor envia o segredo. Até lá,
// aceitamos o cabeçalho `x-webhook-secret` ou `Authorization: Bearer <segredo>`; nunca na URL,
// que acaba em log de proxy e de hospedagem.

export const WEBHOOK_SECRET_HEADER = "x-webhook-secret";
export const WEBHOOK_SECRET_MIN_LENGTH = 16;

type Env = Record<string, string | undefined>;

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export function webhookSecretFrom(headers: Headers): string | null {
  const header = headers.get(WEBHOOK_SECRET_HEADER)?.trim();
  if (header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("authorization")?.trim() ?? "");
  return bearer?.[1].trim() || null;
}

export function isValidWebhookSecret(headers: Headers, env: Env = process.env): boolean {
  const expected = env.WHATSAPP_WEBHOOK_SECRET?.trim() ?? "";
  const received = webhookSecretFrom(headers) ?? "";
  // Compara mesmo quando falta algo, para o tempo não denunciar o motivo da recusa.
  const equal = timingSafeEqual(digest(received), digest(expected));
  return equal && expected.length >= WEBHOOK_SECRET_MIN_LENGTH && received.length > 0;
}
