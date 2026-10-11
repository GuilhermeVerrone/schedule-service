import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isWhatsAppError,
  type ConnectionStatus,
  type DeliveryState,
  type InboundMessage,
  type MediaType,
  type StatusUpdate,
  type WhatsAppProvider,
} from "@/server/whatsapp";

// Contrato do WhatsAppProvider (guia 6, D4, D5). Roda contra qualquer provider que tenha um
// "driver" capaz de fazer o papel do WhatsApp (ler o QR, derrubar a conexão, mandar mensagem,
// confirmar entrega). Hoje: FakeProvider. Um provider novo (ex.: Meta Cloud API) passa por aqui.

export interface WhatsAppContractDriver {
  provider: WhatsAppProvider;
  // Avança o relógio do provider (expiração do QR).
  advance(ms: number): void;
  scanQr(sessionId: string): Promise<void>;
  dropConnection(sessionId: string): Promise<void>;
  suspectBan(sessionId: string): Promise<void>;
  receiveMessage(
    sessionId: string,
    input: { from: string; text?: string; mediaType?: MediaType; profileName?: string },
  ): Promise<void>;
  confirmDelivery(externalId: string, state: DeliveryState): Promise<void>;
  // Envios que o provider registrou (para provar que sendText saiu e para quem).
  sent(): { sessionId: string; to: string; text: string; externalId: string }[];
  qrTtlMs: number;
}

const PHONE = "+5511987654321";

export function describeWhatsAppContract(name: string, makeDriver: () => WhatsAppContractDriver): void {
  describe(`contrato do WhatsAppProvider: ${name}`, () => {
    let driver: WhatsAppContractDriver;
    let provider: WhatsAppProvider;
    let inbound: InboundMessage[];
    let updates: StatusUpdate[];
    let unsubscribe: (() => void)[];

    const connections = () => updates.filter((u): u is ConnectionStatus => u.kind === "connection_status");

    async function connected(): Promise<string> {
      const { sessionId } = await provider.connect();
      await driver.scanQr(sessionId);
      return sessionId;
    }

    beforeEach(() => {
      driver = makeDriver();
      provider = driver.provider;
      inbound = [];
      updates = [];
      unsubscribe = [
        provider.onInboundMessage((event) => void inbound.push(event)),
        provider.onStatusUpdate((event) => void updates.push(event)),
      ];
    });

    afterEach(() => unsubscribe.forEach((off) => off()));

    it("tem um source curto e minúsculo (webhook_events.source)", () => {
      expect(provider.source).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
    });

    describe("conexão por QR", () => {
      it("connect sem sessão cria uma sessão nova em qr_pending com QR e validade", async () => {
        const snapshot = await provider.connect();
        expect(snapshot.sessionId.length).toBeGreaterThanOrEqual(16);
        expect(snapshot.state).toBe("qr_pending");
        expect(snapshot.qr).toMatchObject({ format: expect.stringMatching(/^(text|data_url)$/) });
        expect(snapshot.qr!.value.length).toBeGreaterThan(0);
        expect(snapshot.qr!.expiresAt.getTime()).toBeGreaterThan(snapshot.checkedAt.getTime());
        expect(connections().map((u) => u.state)).toEqual(["qr_pending"]);
      });

      it("cada connect sem sessão gera um sessionId diferente e imprevisível (D8)", async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 20; i += 1) ids.add((await provider.connect()).sessionId);
        expect(ids.size).toBe(20);
      });

      it("o QR expirado é trocado por um novo no getStatus", async () => {
        const first = await provider.connect();
        driver.advance(driver.qrTtlMs + 1);
        const next = await provider.getStatus(first.sessionId);
        expect(next.state).toBe("qr_pending");
        expect(next.qr!.value).not.toBe(first.qr!.value);
        expect(next.qr!.expiresAt.getTime()).toBeGreaterThan(first.qr!.expiresAt.getTime());
      });

      it("ler o QR conecta: evento connected e getStatus sem QR", async () => {
        const sessionId = await connected();
        expect(connections().map((u) => u.state)).toEqual(["qr_pending", "connected"]);
        expect(connections().every((u) => u.sessionId === sessionId && u.eventId.length > 0)).toBe(true);
        const status = await provider.getStatus(sessionId);
        expect(status).toMatchObject({ sessionId, state: "connected", qr: null });
      });

      it("connect numa sessão já conectada não pede QR de novo", async () => {
        const sessionId = await connected();
        const again = await provider.connect({ sessionId });
        expect(again).toMatchObject({ sessionId, state: "connected", qr: null });
      });

      it("queda: evento disconnected com motivo, e reconectar usa a mesma sessão com QR novo", async () => {
        const sessionId = await connected();
        await driver.dropConnection(sessionId);
        const drop = connections().at(-1)!;
        expect(drop).toMatchObject({ kind: "connection_status", sessionId, state: "disconnected" });
        expect(drop.reason).toEqual(expect.any(String));
        expect((await provider.getStatus(sessionId)).state).toBe("disconnected");

        const reconnect = await provider.connect({ sessionId });
        expect(reconnect).toMatchObject({ sessionId, state: "qr_pending" });
        expect(reconnect.qr).not.toBeNull();
        await driver.scanQr(sessionId);
        expect((await provider.getStatus(sessionId)).state).toBe("connected");
      });

      it("suspeita de banimento vira banned_suspected", async () => {
        const sessionId = await connected();
        await driver.suspectBan(sessionId);
        expect(connections().at(-1)).toMatchObject({ sessionId, state: "banned_suspected" });
        expect((await provider.getStatus(sessionId)).state).toBe("banned_suspected");
      });

      it("disconnect encerra a sessão, avisa e impede envio", async () => {
        const sessionId = await connected();
        await provider.disconnect(sessionId);
        expect(connections().at(-1)).toMatchObject({ sessionId, state: "disconnected" });
        expect(await provider.getStatus(sessionId)).toMatchObject({ state: "disconnected", qr: null });
        await expect(provider.sendText({ sessionId, to: PHONE, text: "oi" })).rejects.toSatisfy((error) =>
          isWhatsAppError(error, "not_connected"),
        );
      });

      it("sessão desconhecida: getStatus, sendText e disconnect falham com unknown_session", async () => {
        const unknown = "sessao-que-nao-existe-0000";
        for (const call of [
          provider.getStatus(unknown),
          provider.sendText({ sessionId: unknown, to: PHONE, text: "oi" }),
          provider.disconnect(unknown),
        ]) {
          await expect(call).rejects.toSatisfy((error) => isWhatsAppError(error, "unknown_session"));
        }
      });
    });

    describe("mensagem recebida (InboundMessage)", () => {
      it("texto chega normalizado: telefone em E.164, nome do perfil, ids e horário", async () => {
        const sessionId = await connected();
        await driver.receiveMessage(sessionId, { from: "(11) 98765-4321", text: "Oi, tem horário?", profileName: "Ana" });
        expect(inbound).toEqual([
          {
            kind: "inbound_message",
            eventId: expect.any(String),
            sessionId,
            externalId: expect.any(String),
            from: PHONE,
            profileName: "Ana",
            text: "Oi, tem horário?",
            mediaType: null,
            receivedAt: expect.any(Date),
          },
        ]);
      });

      it("mídia chega só com o tipo (D7) e sem nome de perfil vira null", async () => {
        const sessionId = await connected();
        await driver.receiveMessage(sessionId, { from: "+14155552671", mediaType: "audio" });
        expect(inbound[0]).toMatchObject({ from: "+14155552671", text: null, mediaType: "audio", profileName: null });
      });

      it("mensagens diferentes têm eventId e externalId diferentes", async () => {
        const sessionId = await connected();
        await driver.receiveMessage(sessionId, { from: PHONE, text: "um" });
        await driver.receiveMessage(sessionId, { from: PHONE, text: "dois" });
        expect(new Set(inbound.map((m) => m.eventId)).size).toBe(2);
        expect(new Set(inbound.map((m) => m.externalId)).size).toBe(2);
      });

      it("não chega pelo onStatusUpdate", async () => {
        const sessionId = await connected();
        const before = updates.length;
        await driver.receiveMessage(sessionId, { from: PHONE, text: "oi" });
        expect(updates).toHaveLength(before);
      });
    });

    describe("envio e status de entrega (DeliveryStatus)", () => {
      it("sendText exige sessão conectada", async () => {
        const { sessionId } = await provider.connect();
        await expect(provider.sendText({ sessionId, to: PHONE, text: "oi" })).rejects.toSatisfy((error) =>
          isWhatsAppError(error, "not_connected"),
        );
        expect(driver.sent()).toEqual([]);
      });

      it("sendText recusa telefone fora do E.164 e texto vazio, sem enviar", async () => {
        const sessionId = await connected();
        for (const to of ["11987654321", "(11) 98765-4321", "+55119"]) {
          await expect(provider.sendText({ sessionId, to, text: "oi" })).rejects.toSatisfy((error) =>
            isWhatsAppError(error, "invalid_phone"),
          );
        }
        await expect(provider.sendText({ sessionId, to: PHONE, text: "   " })).rejects.toSatisfy((error) =>
          isWhatsAppError(error, "invalid_payload"),
        );
        expect(driver.sent()).toEqual([]);
      });

      it("sendText registra o envio e devolve o id externo", async () => {
        const sessionId = await connected();
        const result = await provider.sendText({ sessionId, to: PHONE, text: "Seu horário está confirmado." });
        expect(result.state).toMatch(/^(pending|sent)$/);
        expect(driver.sent()).toEqual([
          { sessionId, to: PHONE, text: "Seu horário está confirmado.", externalId: result.externalId },
        ]);
      });

      it.each(["sent", "delivered", "read", "failed"] as const)("entrega %s chega pelo onStatusUpdate", async (state) => {
        const sessionId = await connected();
        const { externalId } = await provider.sendText({ sessionId, to: PHONE, text: "oi" });
        await driver.confirmDelivery(externalId, state);
        expect(updates.at(-1)).toEqual({
          kind: "delivery_status",
          eventId: expect.any(String),
          sessionId,
          externalId,
          state,
          at: expect.any(Date),
        });
        expect(inbound).toEqual([]);
      });
    });

    describe("inscrições", () => {
      it("depois de cancelar a inscrição o handler não recebe mais nada", async () => {
        const sessionId = await connected();
        unsubscribe.forEach((off) => off());
        const before = { inbound: inbound.length, updates: updates.length };
        await driver.receiveMessage(sessionId, { from: PHONE, text: "oi" });
        await driver.dropConnection(sessionId);
        expect({ inbound: inbound.length, updates: updates.length }).toEqual(before);
      });

      it("vários handlers recebem o mesmo evento, em ordem", async () => {
        const order: string[] = [];
        unsubscribe.push(
          provider.onInboundMessage(() => void order.push("a")),
          provider.onInboundMessage(async () => void order.push("b")),
        );
        const sessionId = await connected();
        await driver.receiveMessage(sessionId, { from: PHONE, text: "oi" });
        expect(order).toEqual(["a", "b"]);
      });

      it("erro num handler sobe para quem entregou o evento (o webhook falha e o provedor reenvia)", async () => {
        const sessionId = await connected();
        unsubscribe.push(
          provider.onInboundMessage(() => {
            throw new Error("falha ao gravar");
          }),
        );
        await expect(driver.receiveMessage(sessionId, { from: PHONE, text: "oi" })).rejects.toThrow("falha ao gravar");
      });
    });
  });
}
