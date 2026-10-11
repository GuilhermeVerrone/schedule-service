// Contrato do WhatsApp (guia 3 e 6, D4, D5). O produto só conhece estes tipos e a interface
// WhatsAppProvider: trocar de provedor (AKG hoje, Meta Cloud API no futuro) é escrever um novo
// provider, sem mexer no produto. Nenhum tipo aqui carrega formato de um provedor específico.

// Mesmos valores do CHECK whatsapp_connections_status_check (Fase 2).
export const CONNECTION_STATES = ["connected", "disconnected", "qr_pending", "banned_suspected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

// Status de entrega de uma mensagem enviada (subconjunto do CHECK de messages, sem "pending",
// que é o estado antes de o provedor responder).
export const DELIVERY_STATES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

// Mídia guarda só o tipo, nunca o arquivo nem a URL (D7, LGPD).
export const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker", "other"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// QR code de pareamento. É sensível (dá acesso ao WhatsApp do negócio): não cachear nem logar.
export interface PairingQr {
  // "text": conteúdo a desenhar como QR; "data_url": imagem pronta (data:image/png;base64,...).
  format: "text" | "data_url";
  value: string;
  expiresAt: Date;
}

// Foto do estado da sessão, devolvida por connect e getStatus.
export interface SessionSnapshot {
  sessionId: string;
  state: ConnectionState;
  // Só quando state = "qr_pending".
  qr: PairingQr | null;
  checkedAt: Date;
}

// Eventos normalizados. `eventId` é estável por evento do provedor: o webhook o usa na
// idempotência (webhook_events.event_id, D3, D8).
export interface InboundMessage {
  kind: "inbound_message";
  eventId: string;
  sessionId: string;
  // Id da mensagem no provedor (messages.external_id).
  externalId: string;
  // Telefone de quem escreveu, já em E.164.
  from: string;
  // Nome do perfil do WhatsApp, se o provedor enviar (D12).
  profileName: string | null;
  text: string | null;
  mediaType: MediaType | null;
  receivedAt: Date;
}

export interface DeliveryStatus {
  kind: "delivery_status";
  eventId: string;
  sessionId: string;
  externalId: string;
  state: DeliveryState;
  at: Date;
}

export interface ConnectionStatus {
  kind: "connection_status";
  eventId: string;
  sessionId: string;
  state: ConnectionState;
  // Motivo curto, sem dado sensível (ex.: "logged_out", "qr_expired").
  reason: string | null;
  at: Date;
}

export type StatusUpdate = DeliveryStatus | ConnectionStatus;
export type WhatsAppEvent = InboundMessage | StatusUpdate;

export interface SendTextInput {
  sessionId: string;
  // E.164 (o mesmo formato de contacts.phone).
  to: string;
  text: string;
}

export interface SendTextResult {
  externalId: string;
  state: "pending" | "sent";
}

export type Unsubscribe = () => void;
export type Handler<T> = (event: T) => void | Promise<void>;

export interface WhatsAppProvider {
  // Nome curto e minúsculo do provedor (webhook_events.source).
  readonly source: string;

  // Abre ou retoma a sessão. Sem sessionId, cria uma nova; com, reconecta a mesma.
  // Sessão não conectada volta em "qr_pending" com o QR a ler.
  connect(input?: { sessionId?: string }): Promise<SessionSnapshot>;
  getStatus(sessionId: string): Promise<SessionSnapshot>;
  // Nesta fatia nenhuma tela ou fluxo chama sendText (D5); só testes.
  sendText(input: SendTextInput): Promise<SendTextResult>;
  disconnect(sessionId: string): Promise<void>;

  onInboundMessage(handler: Handler<InboundMessage>): Unsubscribe;
  // Entrega de mensagem enviada e mudança de conexão.
  onStatusUpdate(handler: Handler<StatusUpdate>): Unsubscribe;

  // Normaliza o corpo do webhook do provedor, avisa os handlers e devolve os eventos (a rota do
  // webhook da Fase 5 processa no mesmo request, D3). Corpo inválido: WhatsAppProviderError
  // "invalid_payload".
  handleWebhook(payload: unknown): Promise<WhatsAppEvent[]>;
}
