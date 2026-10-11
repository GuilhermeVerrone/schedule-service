import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isNormalizedPhone, normalizePhone } from "@/lib/phone";
import { WhatsAppProviderError } from "./errors";
import { EventHub } from "./event-hub";
import {
  CONNECTION_STATES,
  DELIVERY_STATES,
  MEDIA_TYPES,
  type ConnectionState,
  type ConnectionStatus,
  type DeliveryState,
  type DeliveryStatus,
  type Handler,
  type InboundMessage,
  type MediaType,
  type PairingQr,
  type SendTextInput,
  type SendTextResult,
  type SessionSnapshot,
  type StatusUpdate,
  type Unsubscribe,
  type WhatsAppEvent,
  type WhatsAppProvider,
} from "./types";

// Provider em memória para testes, E2E e desenvolvimento (guia 3, D5). Simula o lado do
// WhatsApp: QR que expira e é renovado, leitura do QR, queda, suspeita de banimento, mensagem
// recebida e status de entrega. Tudo o que ele "avisa" passa por handleWebhook, como faria um
// provedor real chamando o webhook. Envios ficam registrados em `sentMessages`.

export const FAKE_QR_TTL_MS = 60_000;

export interface FakeSentMessage {
  sessionId: string;
  to: string;
  text: string;
  externalId: string;
  sentAt: Date;
}

export interface FakeProviderOptions {
  now?: () => Date;
  qrTtlMs?: number;
}

interface FakeSession {
  state: ConnectionState;
  qr: PairingQr | null;
}

// Corpo do webhook do Fake. O eventId é derivado do conteúdo quando não vem: reenviar o mesmo
// corpo gera o mesmo id (idempotência).
const timestamp = z.coerce.date().optional();
const fakeWebhookSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    eventId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    from: z.string().min(1),
    profileName: z.string().trim().min(1).max(200).nullish(),
    text: z.string().min(1).nullish(),
    mediaType: z.enum(MEDIA_TYPES).nullish(),
    timestamp,
  }),
  z.object({
    type: z.literal("delivery"),
    eventId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    state: z.enum(DELIVERY_STATES),
    timestamp,
  }),
  z.object({
    type: z.literal("connection"),
    eventId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    state: z.enum(CONNECTION_STATES),
    reason: z.string().min(1).max(64).nullish(),
    timestamp,
  }),
]);

export type FakeWebhookPayload = z.input<typeof fakeWebhookSchema>;

export interface FakeInboundInput {
  from: string;
  text?: string | null;
  mediaType?: MediaType | null;
  profileName?: string | null;
  messageId?: string;
}

const token = () => randomBytes(16).toString("base64url");

export class FakeProvider implements WhatsAppProvider {
  readonly source = "fake";
  readonly sentMessages: FakeSentMessage[] = [];

  private readonly hub = new EventHub();
  private readonly sessions = new Map<string, FakeSession>();
  private readonly now: () => Date;
  private readonly qrTtlMs: number;
  private qrSeq = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.qrTtlMs = options.qrTtlMs ?? FAKE_QR_TTL_MS;
  }

  async connect(input: { sessionId?: string } = {}): Promise<SessionSnapshot> {
    const sessionId = input.sessionId ?? `fake_${token()}`;
    const session = this.sessions.get(sessionId) ?? { state: "disconnected", qr: null };
    this.sessions.set(sessionId, session);
    if (session.state !== "connected" && session.state !== "qr_pending") {
      session.qr = this.newQr(sessionId);
      await this.pushConnection(sessionId, "qr_pending", null);
    }
    return this.getStatus(sessionId);
  }

  async getStatus(sessionId: string): Promise<SessionSnapshot> {
    const session = this.session(sessionId);
    // Como nos gateways de QR: o código expirado é trocado por um novo enquanto ninguém lê.
    if (session.state === "qr_pending" && session.qr && session.qr.expiresAt <= this.now()) {
      session.qr = this.newQr(sessionId);
    }
    return this.snapshot(sessionId, session);
  }

  async sendText({ sessionId, to, text }: SendTextInput): Promise<SendTextResult> {
    const session = this.session(sessionId);
    if (session.state !== "connected") {
      throw new WhatsAppProviderError("not_connected", "Sessão do WhatsApp não está conectada.");
    }
    if (!isNormalizedPhone(to)) throw new WhatsAppProviderError("invalid_phone", "Telefone fora do E.164.");
    if (text.trim() === "") throw new WhatsAppProviderError("invalid_payload", "Mensagem vazia.");
    const externalId = `fake_msg_${token()}`;
    this.sentMessages.push({ sessionId, to, text, externalId, sentAt: this.now() });
    return { externalId, state: "sent" };
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.session(sessionId);
    session.qr = null;
    if (session.state !== "disconnected") await this.pushConnection(sessionId, "disconnected", "logged_out");
  }

  onInboundMessage(handler: Handler<InboundMessage>): Unsubscribe {
    return this.hub.onInboundMessage(handler);
  }

  onStatusUpdate(handler: Handler<StatusUpdate>): Unsubscribe {
    return this.hub.onStatusUpdate(handler);
  }

  // Não exige sessão conhecida em memória: num servidor real o webhook chega a qualquer
  // instância. O tenant é resolvido depois pelo sessionId no banco (D8).
  async handleWebhook(payload: unknown): Promise<WhatsAppEvent[]> {
    const event = this.normalize(payload);
    if (event.kind === "connection_status") {
      const session = this.sessions.get(event.sessionId);
      if (session) {
        session.state = event.state;
        if (event.state !== "qr_pending") session.qr = null;
      }
    }
    await this.hub.emit(event);
    return [event];
  }

  // ---- Simulação do lado do WhatsApp (só testes, E2E e desenvolvimento) ----

  // O dono leu o QR com o celular.
  async simulateQrScan(sessionId: string): Promise<ConnectionStatus> {
    const session = this.session(sessionId);
    if (session.state !== "qr_pending" || !session.qr) throw new Error("Fake: sessão sem QR para ler");
    if (session.qr.expiresAt <= this.now()) throw new Error("Fake: QR expirado");
    return this.pushConnection(sessionId, "connected", null);
  }

  // A conexão caiu (celular sem internet, sessão encerrada no aparelho).
  async simulateDisconnect(sessionId: string, reason = "connection_lost"): Promise<ConnectionStatus> {
    this.session(sessionId);
    return this.pushConnection(sessionId, "disconnected", reason);
  }

  async simulateBan(sessionId: string): Promise<ConnectionStatus> {
    this.session(sessionId);
    return this.pushConnection(sessionId, "banned_suspected", "banned");
  }

  // Um cliente escreveu para o WhatsApp do negócio.
  async simulateInboundMessage(sessionId: string, input: FakeInboundInput): Promise<InboundMessage> {
    if (this.session(sessionId).state !== "connected") {
      throw new WhatsAppProviderError("not_connected", "Sessão do WhatsApp não está conectada.");
    }
    const [event] = await this.handleWebhook({
      type: "message",
      sessionId,
      messageId: input.messageId ?? `fake_in_${token()}`,
      from: input.from,
      profileName: input.profileName ?? null,
      text: input.text ?? null,
      mediaType: input.mediaType ?? null,
      timestamp: this.now(),
    } satisfies FakeWebhookPayload);
    return event as InboundMessage;
  }

  // O WhatsApp confirmou a entrega (ou a leitura, ou a falha) de uma mensagem enviada.
  async simulateDeliveryStatus(externalId: string, state: DeliveryState): Promise<DeliveryStatus> {
    const sent = this.sentMessages.find((message) => message.externalId === externalId);
    if (!sent) throw new Error("Fake: mensagem enviada não encontrada");
    const [event] = await this.handleWebhook({
      type: "delivery",
      sessionId: sent.sessionId,
      messageId: externalId,
      state,
      timestamp: this.now(),
    } satisfies FakeWebhookPayload);
    return event as DeliveryStatus;
  }

  // Limpa sessões e envios (os handlers inscritos continuam).
  reset(): void {
    this.sessions.clear();
    this.sentMessages.length = 0;
  }

  private session(sessionId: string): FakeSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new WhatsAppProviderError("unknown_session", "Sessão do WhatsApp desconhecida.");
    return session;
  }

  private snapshot(sessionId: string, session: FakeSession): SessionSnapshot {
    const qr = session.state === "qr_pending" && session.qr ? { ...session.qr } : null;
    return { sessionId, state: session.state, qr, checkedAt: this.now() };
  }

  private newQr(sessionId: string): PairingQr {
    this.qrSeq += 1;
    return {
      format: "text",
      value: `slotz-fake-qr:${sessionId}:${this.qrSeq}:${token()}`,
      expiresAt: new Date(this.now().getTime() + this.qrTtlMs),
    };
  }

  private async pushConnection(
    sessionId: string,
    state: ConnectionState,
    reason: string | null,
  ): Promise<ConnectionStatus> {
    const [event] = await this.handleWebhook({
      type: "connection",
      sessionId,
      state,
      reason,
      timestamp: this.now(),
    } satisfies FakeWebhookPayload);
    return event as ConnectionStatus;
  }

  private normalize(payload: unknown): WhatsAppEvent {
    const parsed = fakeWebhookSchema.safeParse(payload);
    if (!parsed.success) throw new WhatsAppProviderError("invalid_payload", "Corpo do webhook inválido.");
    const body = parsed.data;
    const at = body.timestamp ?? this.now();

    if (body.type === "message") {
      const from = normalizePhone(body.from);
      if (!from) throw new WhatsAppProviderError("invalid_payload", "Telefone de origem inválido.");
      if (!body.text && !body.mediaType) {
        throw new WhatsAppProviderError("invalid_payload", "Mensagem sem texto e sem mídia.");
      }
      return {
        kind: "inbound_message",
        eventId: body.eventId ?? `inbound:${body.messageId}`,
        sessionId: body.sessionId,
        externalId: body.messageId,
        from,
        profileName: body.profileName ?? null,
        text: body.text ?? null,
        mediaType: body.mediaType ?? null,
        receivedAt: at,
      };
    }
    if (body.type === "delivery") {
      return {
        kind: "delivery_status",
        eventId: body.eventId ?? `delivery:${body.messageId}:${body.state}`,
        sessionId: body.sessionId,
        externalId: body.messageId,
        state: body.state,
        at,
      };
    }
    return {
      kind: "connection_status",
      eventId: body.eventId ?? `connection:${body.sessionId}:${body.state}:${at.getTime()}`,
      sessionId: body.sessionId,
      state: body.state,
      reason: body.reason ?? null,
      at,
    };
  }
}
