import { ZodError } from "zod";
import { enqueueMessage, type EnqueueInput, type EnqueueResult } from "@/server/outbound/enqueue";
import {
  createWhatsAppWebhookRepository,
  type WebhookResult,
  type WhatsAppWebhookRepository,
} from "@/server/repositories/whatsapp-webhook-repository";
import { isWhatsAppError, type WhatsAppProvider } from "@/server/whatsapp";
import { optOutConfirmationKey } from "./opt-out";

// Processamento do webhook do WhatsApp no mesmo request (D3): o provider normaliza o corpo e cada
// evento é gravado com idempotência pelo repositório do webhook, que resolve o tenant só pela
// sessão (D8). Corpo inválido não é erro do servidor: vira "invalid" e a rota responde 200 vazio,
// para o provedor não reenviar. Falha de banco sobe: a rota responde 500 e o reenvio do provedor
// é coberto pela idempotência. Opt-out (D4, D15): o `opt_out` já foi gravado com o evento; a
// confirmação única vai para a fila depois do commit, e uma falha dela não desfaz o opt-out nem
// derruba o webhook (fica no log, sem telefone nem texto).

export interface WebhookOutcome {
  status: "processed" | "invalid";
  // Contagem por resultado, para o log (nunca o conteúdo).
  results: Record<WebhookResult["status"], number>;
}

export type EnqueueFn = (input: EnqueueInput) => Promise<EnqueueResult>;

const emptyResults = (): WebhookOutcome["results"] => ({ processed: 0, duplicate: 0, unknown_session: 0 });

export async function processWhatsAppWebhook(
  provider: WhatsAppProvider,
  payload: unknown,
  repo: WhatsAppWebhookRepository = createWhatsAppWebhookRepository(),
  enqueue: EnqueueFn = enqueueMessage,
): Promise<WebhookOutcome> {
  const results = emptyResults();
  try {
    const events = await provider.handleWebhook(payload);
    for (const event of events) {
      const result = await repo.recordEvent(provider.source, event);
      results[result.status] += 1;
      if (result.status === "processed" && result.optOutConfirmation) {
        await enqueueOptOutConfirmation(enqueue, result.tenantId, result.optOutConfirmation.contactId);
      }
    }
    return { status: "processed", results };
  } catch (error) {
    if (isWhatsAppError(error, "invalid_payload") || error instanceof ZodError) return { status: "invalid", results };
    throw error;
  }
}

async function enqueueOptOutConfirmation(enqueue: EnqueueFn, tenantId: string, contactId: string): Promise<void> {
  try {
    const result = await enqueue({
      tenantId,
      contactId,
      messageType: "optout_confirmation",
      idempotencyKey: optOutConfirmationKey(contactId),
    });
    console.info(JSON.stringify({ event: "optout_confirmation_enqueued", tenantId, status: result.status }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "optout_confirmation_enqueue_failed",
        tenantId,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
