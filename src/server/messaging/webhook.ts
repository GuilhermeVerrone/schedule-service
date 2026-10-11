import { ZodError } from "zod";
import {
  createWhatsAppWebhookRepository,
  type WebhookResult,
  type WhatsAppWebhookRepository,
} from "@/server/repositories/whatsapp-webhook-repository";
import { isWhatsAppError, type WhatsAppProvider } from "@/server/whatsapp";

// Processamento do webhook do WhatsApp no mesmo request (D3): o provider normaliza o corpo e cada
// evento é gravado com idempotência pelo repositório do webhook, que resolve o tenant só pela
// sessão (D8). Corpo inválido não é erro do servidor: vira "invalid" e a rota responde 200 vazio,
// para o provedor não reenviar. Falha de banco sobe: a rota responde 500 e o reenvio do provedor
// é coberto pela idempotência.

export interface WebhookOutcome {
  status: "processed" | "invalid";
  // Contagem por resultado, para o log (nunca o conteúdo).
  results: Record<WebhookResult["status"], number>;
}

const emptyResults = (): WebhookOutcome["results"] => ({ processed: 0, duplicate: 0, unknown_session: 0 });

export async function processWhatsAppWebhook(
  provider: WhatsAppProvider,
  payload: unknown,
  repo: WhatsAppWebhookRepository = createWhatsAppWebhookRepository(),
): Promise<WebhookOutcome> {
  const results = emptyResults();
  try {
    const events = await provider.handleWebhook(payload);
    for (const event of events) {
      const result = await repo.recordEvent(provider.source, event);
      results[result.status] += 1;
    }
    return { status: "processed", results };
  } catch (error) {
    if (isWhatsAppError(error, "invalid_payload") || error instanceof ZodError) return { status: "invalid", results };
    throw error;
  }
}
