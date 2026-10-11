import type { NextRequest } from "next/server";
import { errorResponse } from "@/server/http/errors";
import { PUBLIC_RESPONSE_HEADERS } from "@/server/http/public-route";
import { allowPublicRequest, retryAfterSeconds } from "@/server/http/rate-limit";
import { isValidWebhookSecret } from "@/server/http/webhook-secret";
import { processWhatsAppWebhook } from "@/server/messaging/webhook";
import { getWhatsAppProvider } from "@/server/whatsapp";

// POST /api/webhooks/whatsapp: eventos do provedor do WhatsApp (guia 3, 6, 7c, 7f; D3, D8).
// Pública no proxy: sem sessão e sem tenantId injetado. Ordem: limite por IP, segredo em tempo
// constante, corpo. O tenant vem só da sessão do provedor gravada na conexão, nunca do corpo.
// Respostas sem conteúdo: corpo inválido, sessão desconhecida e evento repetido também dão 200,
// para o provedor não reenviar; o motivo vai só para o log, sem o conteúdo da mensagem.

// Teto do corpo: eventos de texto e só o tipo da mídia (D7) cabem com folga.
const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

type LogFields = Record<string, string | number>;

function log(level: "info" | "warn" | "error", outcome: string, fields: LogFields = {}): void {
  console[level](JSON.stringify({ event: "whatsapp_webhook", outcome, ...fields }));
}

function withHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(PUBLIC_RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

const empty = (status: number): Response => withHeaders(new Response(null, { status }));

async function readPayload(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > WEBHOOK_MAX_BODY_BYTES) return undefined;
  const text = await request.text().catch(() => "");
  if (text === "" || Buffer.byteLength(text, "utf8") > WEBHOOK_MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await allowPublicRequest("whatsappWebhook", request.headers))) {
    log("warn", "rate_limited");
    const response = errorResponse(429, "rate_limited", "Muitas requisições. Tente de novo em instantes.");
    response.headers.set("Retry-After", String(retryAfterSeconds("whatsappWebhook")));
    return withHeaders(response);
  }

  if (!isValidWebhookSecret(request.headers)) {
    log("warn", "unauthorized");
    return withHeaders(errorResponse(401, "unauthorized", "Credencial do webhook inválida."));
  }

  let source = "unknown";
  try {
    const provider = getWhatsAppProvider();
    source = provider.source;
    const payload = await readPayload(request);
    if (payload === undefined) {
      log("warn", "invalid_body", { source });
      return empty(200);
    }
    const outcome = await processWhatsAppWebhook(provider, payload);
    if (outcome.status === "invalid") log("warn", "invalid_body", { source });
    else log("info", "processed", { source, ...outcome.results });
    return empty(200);
  } catch (error) {
    // Sem a mensagem do erro: pode citar dado do evento. O provedor reenvia e a idempotência cobre.
    log("error", "failed", { source, error: error instanceof Error ? error.name : "unknown" });
    return empty(500);
  }
}
