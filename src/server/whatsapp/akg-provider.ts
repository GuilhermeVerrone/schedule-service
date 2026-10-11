import { WhatsAppProviderError } from "./errors";
import { EventHub } from "./event-hub";
import type {
  Handler,
  InboundMessage,
  SendTextInput,
  SendTextResult,
  SessionSnapshot,
  StatusUpdate,
  Unsubscribe,
  WhatsAppEvent,
  WhatsAppProvider,
} from "./types";

// Provider do WA-AKG (WhatsApp não oficial, conexão por QR). Único arquivo do projeto que fala
// com o AKG: o produto usa só WhatsAppProvider (guia 6).
//
// Premissa da Fatia 3 (decisoes.md): sem o Swagger de uma instância, nenhum endpoint é inventado.
// Cada operação falha com "not_implemented" até o item correspondente ser confirmado.
//
// TODO(AKG) — confirmar no Swagger de uma instância antes de implementar:
//   1. Autenticação: nome do header (ou query) da AKG_API_KEY e se a chave é por instância.
//   2. Criar sessão: endpoint, se aceita um id escolhido por nós (imprevisível, D8) ou devolve
//      o seu; limite de sessões por chave.
//   3. Obter QR: endpoint, formato (texto do QR ou imagem base64), validade e renovação.
//   4. Status da sessão: endpoint e valores possíveis, e como mapear para connected,
//      disconnected, qr_pending e banned_suspected (existe sinal de banimento?).
//   5. Enviar texto: endpoint, formato do destinatário (E.164, só dígitos ou JID
//      "<número>@s.whatsapp.net"), id da mensagem na resposta. Nunca usar broadcast.
//   6. Desconectar: logout x apagar sessão (o que permite reconectar com o mesmo id).
//   7. Webhook: como cadastrar a URL ({APP_BASE_URL}/api/webhooks/whatsapp), como enviar o
//      WHATSAPP_WEBHOOK_SECRET (header, query ou assinatura HMAC), nome dos eventos (mensagem,
//      ack de entrega, conexão), onde vem o id da sessão, o id do evento (idempotência), o
//      telefone de origem, o nome do perfil e o tipo de mídia; se reenvia em erro e com qual
//      timeout.
//   8. Limites e erros: códigos HTTP, rate limit do próprio AKG, timeout recomendado.

export const AKG_SOURCE = "akg";
export const AKG_TIMEOUT_MS = 10_000;

// Endpoints do AKG. null = ainda não confirmado (lista acima).
export const AKG_ENDPOINTS = {
  createSession: null, // TODO(AKG) item 2
  getQr: null, // TODO(AKG) item 3
  getStatus: null, // TODO(AKG) item 4
  sendText: null, // TODO(AKG) item 5
  disconnect: null, // TODO(AKG) item 6
  webhookFormat: null, // TODO(AKG) item 7
} as const satisfies Record<string, string | null>;

export type AkgOperation = keyof typeof AKG_ENDPOINTS;

export interface AkgConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Chamada HTTP ao AKG com timeout. Os erros nunca levam a URL completa, a chave nem o corpo da
// resposta (podem ter dado de cliente): só o status e a operação.
export async function akgRequestJson(
  fetchFn: typeof fetch,
  url: URL,
  init: RequestInit,
  operation: string,
  timeoutMs: number = AKG_TIMEOUT_MS,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new WhatsAppProviderError("provider_unavailable", `AKG indisponível (${operation}).`);
  }
  if (!response.ok) {
    throw new WhatsAppProviderError("provider_unavailable", `AKG respondeu ${response.status} (${operation}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new WhatsAppProviderError("provider_unavailable", `AKG respondeu sem JSON (${operation}).`);
  }
}

export class AkgProvider implements WhatsAppProvider {
  readonly source = AKG_SOURCE;

  private readonly hub = new EventHub();
  // Guardados para os endpoints confirmados; nunca saem deste objeto nem vão para log.
  readonly #baseUrl: URL;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(config: AkgConfig) {
    if (!config.apiKey?.trim()) throw new WhatsAppProviderError("misconfigured", "AKG_API_KEY não definida.");
    if (!URL.canParse(config.baseUrl ?? "")) {
      throw new WhatsAppProviderError("misconfigured", "AKG_BASE_URL ausente ou inválida.");
    }
    const baseUrl = new URL(config.baseUrl);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
      throw new WhatsAppProviderError("misconfigured", "AKG_BASE_URL deve ser http(s).");
    }
    this.#baseUrl = baseUrl;
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetch ?? fetch;
    this.#timeoutMs = config.timeoutMs ?? AKG_TIMEOUT_MS;
  }

  async connect(input?: { sessionId?: string }): Promise<SessionSnapshot> {
    void input;
    // TODO(AKG) itens 2 e 3: criar ou retomar a sessão e devolver o QR normalizado.
    return this.todo("createSession");
  }

  async getStatus(sessionId: string): Promise<SessionSnapshot> {
    void sessionId;
    // TODO(AKG) item 4: status da sessão mapeado para ConnectionState.
    return this.todo("getStatus");
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    void input;
    // TODO(AKG) item 5: destinatário a partir do E.164 e id da mensagem na resposta.
    return this.todo("sendText");
  }

  async disconnect(sessionId: string): Promise<void> {
    void sessionId;
    // TODO(AKG) item 6.
    return this.todo("disconnect");
  }

  onInboundMessage(handler: Handler<InboundMessage>): Unsubscribe {
    return this.hub.onInboundMessage(handler);
  }

  onStatusUpdate(handler: Handler<StatusUpdate>): Unsubscribe {
    return this.hub.onStatusUpdate(handler);
  }

  async handleWebhook(payload: unknown): Promise<WhatsAppEvent[]> {
    void payload;
    // TODO(AKG) item 7: validar o corpo (Zod), normalizar para InboundMessage, DeliveryStatus e
    // ConnectionStatus (telefone via normalizePhone, mídia só o tipo) e emitir no hub.
    return this.todo("webhookFormat");
  }

  // Monta a URL de um endpoint confirmado e chama o AKG. Sem uso até a lista acima ser fechada.
  protected request(operation: AkgOperation, path: string, init: RequestInit = {}): Promise<unknown> {
    // TODO(AKG) item 1: aplicar a #apiKey no header confirmado.
    void this.#apiKey;
    return akgRequestJson(this.#fetch, new URL(path, this.#baseUrl), init, operation, this.#timeoutMs);
  }

  private todo(operation: AkgOperation): never {
    throw new WhatsAppProviderError(
      "not_implemented",
      `AKG: operação "${operation}" aguarda confirmação no Swagger (TODO).`,
    );
  }
}
