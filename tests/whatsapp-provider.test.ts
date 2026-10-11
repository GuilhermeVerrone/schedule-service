import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeProvider, getWhatsAppProvider, isWhatsAppError, resetWhatsAppProvider, type WhatsAppEvent } from "@/server/whatsapp";
import { AKG_ENDPOINTS, AkgProvider, akgRequestJson } from "@/server/whatsapp/akg-provider";
import { createWhatsAppProvider, resolveProviderKind } from "@/server/whatsapp/factory";
import { FAKE_QR_TTL_MS } from "@/server/whatsapp/fake-provider";
import { describeWhatsAppContract } from "./helpers/whatsapp-contract";

// Fase 3 da Fatia 3: adapter do WhatsApp sem banco, rotas nem telas.

function fakeDriver() {
  let now = new Date("2026-10-10T12:00:00.000Z").getTime();
  const provider = new FakeProvider({ now: () => new Date(now) });
  return {
    provider,
    qrTtlMs: FAKE_QR_TTL_MS,
    advance: (ms: number) => void (now += ms),
    scanQr: async (sessionId: string) => void (await provider.simulateQrScan(sessionId)),
    dropConnection: async (sessionId: string) => void (await provider.simulateDisconnect(sessionId)),
    suspectBan: async (sessionId: string) => void (await provider.simulateBan(sessionId)),
    receiveMessage: async (sessionId: string, input: Parameters<FakeProvider["simulateInboundMessage"]>[1]) =>
      void (await provider.simulateInboundMessage(sessionId, input)),
    confirmDelivery: async (externalId: string, state: "sent" | "delivered" | "read" | "failed") =>
      void (await provider.simulateDeliveryStatus(externalId, state)),
    sent: () => provider.sentMessages.map(({ sessionId, to, text, externalId }) => ({ sessionId, to, text, externalId })),
  };
}

describeWhatsAppContract("FakeProvider", fakeDriver);

describe("FakeProvider: webhook e simulação", () => {
  const message = { type: "message", sessionId: "sessao-externa-123", messageId: "wamid-1", from: "11987654321", text: "oi" };

  it("o mesmo corpo reenviado gera o mesmo eventId (idempotência no webhook)", async () => {
    const provider = new FakeProvider();
    const [first] = await provider.handleWebhook(message);
    const [again] = await provider.handleWebhook(structuredClone(message));
    expect(first.eventId).toBe(again.eventId);
    const delivery = { type: "delivery", sessionId: "s-1", messageId: "m-1", state: "read" };
    expect((await provider.handleWebhook(delivery))[0].eventId).toBe((await provider.handleWebhook(delivery))[0].eventId);
  });

  it("aceita webhook de sessão que não está em memória (o tenant sai do banco pelo sessionId, D8)", async () => {
    const provider = new FakeProvider();
    const received: WhatsAppEvent[] = [];
    provider.onInboundMessage((event) => void received.push(event));
    const events = await provider.handleWebhook(message);
    expect(events).toEqual(received);
    expect(received[0]).toMatchObject({ sessionId: "sessao-externa-123", externalId: "wamid-1", from: "+5511987654321" });
  });

  it("evento de conexão pelo webhook atualiza a sessão em memória", async () => {
    const provider = new FakeProvider();
    const { sessionId } = await provider.connect();
    await provider.handleWebhook({ type: "connection", sessionId, state: "connected" });
    expect(await provider.getStatus(sessionId)).toMatchObject({ state: "connected", qr: null });
  });

  it.each([
    ["nulo", null],
    ["texto", "oi"],
    ["tipo desconhecido", { type: "broadcast", sessionId: "s" }],
    ["mensagem sem sessão", { ...message, sessionId: "" }],
    ["telefone inválido", { ...message, from: "abc" }],
    ["sem texto e sem mídia", { ...message, text: null }],
    ["mídia fora da lista", { ...message, text: null, mediaType: "https://cdn/x.jpg" }],
    ["status de entrega inválido", { type: "delivery", sessionId: "s", messageId: "m", state: "pending" }],
    ["status de conexão inválido", { type: "connection", sessionId: "s", state: "online" }],
  ])("corpo inválido (%s) falha com invalid_payload e não avisa ninguém", async (_label, payload) => {
    const provider = new FakeProvider();
    const handler = vi.fn();
    provider.onInboundMessage(handler);
    provider.onStatusUpdate(handler);
    await expect(provider.handleWebhook(payload)).rejects.toSatisfy((error) => isWhatsAppError(error, "invalid_payload"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("não deixa ler QR expirado nem receber mensagem desconectado", async () => {
    let now = 0;
    const provider = new FakeProvider({ now: () => new Date(now), qrTtlMs: 1000 });
    const { sessionId } = await provider.connect();
    now = 1000;
    await expect(provider.simulateQrScan(sessionId)).rejects.toThrow("QR expirado");
    await expect(provider.simulateInboundMessage(sessionId, { from: "+5511987654321", text: "oi" })).rejects.toSatisfy(
      (error) => isWhatsAppError(error, "not_connected"),
    );
  });

  it("connect com sessionId desconhecido recria a sessão com o mesmo id (servidor reiniciado)", async () => {
    const provider = new FakeProvider();
    const snapshot = await provider.connect({ sessionId: "sessao-do-banco-abc123" });
    expect(snapshot).toMatchObject({ sessionId: "sessao-do-banco-abc123", state: "qr_pending" });
  });

  it("o snapshot é uma cópia: alterar o QR devolvido não muda o provider", async () => {
    const provider = new FakeProvider();
    const snapshot = await provider.connect();
    snapshot.qr!.value = "alterado";
    expect((await provider.getStatus(snapshot.sessionId)).qr!.value).not.toBe("alterado");
  });

  it("reset limpa sessões e envios", async () => {
    const provider = new FakeProvider();
    const { sessionId } = await provider.connect();
    await provider.simulateQrScan(sessionId);
    await provider.sendText({ sessionId, to: "+5511987654321", text: "oi" });
    provider.reset();
    expect(provider.sentMessages).toEqual([]);
    await expect(provider.getStatus(sessionId)).rejects.toSatisfy((error) => isWhatsAppError(error, "unknown_session"));
  });
});

describe("AkgProvider (endpoints TODO até o Swagger)", () => {
  const config = { baseUrl: "https://akg.exemplo.invalid", apiKey: "chave-de-teste-nao-real-123" };

  it("recusa configuração ausente ou inválida", () => {
    for (const bad of [
      { ...config, apiKey: "" },
      { ...config, apiKey: "   " },
      { ...config, baseUrl: "" },
      { ...config, baseUrl: "nao-e-url" },
      { ...config, baseUrl: "ftp://akg.exemplo.invalid" },
    ]) {
      expect(() => new AkgProvider(bad)).toThrow(expect.objectContaining({ code: "misconfigured" }));
    }
  });

  it("nenhum endpoint foi inventado: todos aguardam confirmação", () => {
    expect(Object.values(AKG_ENDPOINTS).every((endpoint) => endpoint === null)).toBe(true);
  });

  it("toda operação falha com not_implemented sem chamar a rede nem vazar a chave", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const provider = new AkgProvider({ ...config, fetch: fetchSpy });
    const calls = [
      provider.connect(),
      provider.getStatus("s"),
      provider.sendText({ sessionId: "s", to: "+5511987654321", text: "oi" }),
      provider.disconnect("s"),
      provider.handleWebhook({}),
    ];
    for (const call of calls) {
      const error = await call.catch((caught: unknown) => caught);
      expect(isWhatsAppError(error, "not_implemented")).toBe(true);
      expect(String((error as Error).message)).not.toContain(config.apiKey);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("source é akg e as inscrições funcionam (o webhook vai emitir quando o formato for confirmado)", () => {
    const provider = new AkgProvider(config);
    expect(provider.source).toBe("akg");
    const off = provider.onInboundMessage(() => {});
    expect(typeof off).toBe("function");
    off();
    provider.onStatusUpdate(() => {})();
  });

  it("a chave não aparece ao serializar ou inspecionar o provider", () => {
    const provider = new AkgProvider(config);
    expect(JSON.stringify(provider)).not.toContain(config.apiKey);
    expect(Object.values(provider).map(String).join(" ")).not.toContain(config.apiKey);
  });
});

describe("akgRequestJson (HTTP do AKG)", () => {
  const url = new URL("https://usuario:senha@akg.exemplo.invalid/caminho?token=segredo");
  const leaks = (error: unknown) => ["senha", "segredo", "akg.exemplo.invalid"].some((part) => String(error).includes(part));

  it("devolve o JSON e repassa o init com sinal de timeout", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    await expect(akgRequestJson(fetchSpy, url, { method: "POST" }, "teste")).resolves.toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
  });

  it.each([
    ["erro de rede", async () => Promise.reject(new Error("ECONNREFUSED https://usuario:senha@akg.exemplo.invalid"))],
    ["HTTP 500", async () => new Response("detalhe interno com segredo", { status: 500 })],
    ["HTTP 401", async () => new Response("chave inválida", { status: 401 })],
    ["resposta sem JSON", async () => new Response("<html>segredo</html>", { status: 200 })],
  ] as const)("%s vira provider_unavailable sem URL, chave nem corpo na mensagem", async (_label, impl) => {
    const error = await akgRequestJson(vi.fn<typeof fetch>(impl), url, {}, "teste").catch((caught: unknown) => caught);
    expect(isWhatsAppError(error, "provider_unavailable")).toBe(true);
    expect(leaks(error)).toBe(false);
  });

  it("estoura o timeout", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const error = await akgRequestJson(hang, url, {}, "teste", 20).catch((caught: unknown) => caught);
    expect(isWhatsAppError(error, "provider_unavailable")).toBe(true);
  });
});

describe("fábrica do provider por env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetWhatsAppProvider();
  });

  it("escolhe pela WHATSAPP_PROVIDER, sem diferenciar maiúsculas", () => {
    expect(resolveProviderKind({ WHATSAPP_PROVIDER: "akg" })).toBe("akg");
    expect(resolveProviderKind({ WHATSAPP_PROVIDER: " FAKE " })).toBe("fake");
    expect(resolveProviderKind({ WHATSAPP_PROVIDER: "fake", NODE_ENV: "production" })).toBe("fake");
  });

  it("sem a env: Fake fora de produção, erro em produção", () => {
    expect(resolveProviderKind({})).toBe("fake");
    expect(resolveProviderKind({ NODE_ENV: "test" })).toBe("fake");
    expect(() => resolveProviderKind({ NODE_ENV: "production" })).toThrow(expect.objectContaining({ code: "misconfigured" }));
  });

  it("valor desconhecido é erro de configuração", () => {
    expect(() => resolveProviderKind({ WHATSAPP_PROVIDER: "meta" })).toThrow(expect.objectContaining({ code: "misconfigured" }));
  });

  it("akg usa AKG_BASE_URL e AKG_API_KEY; sem elas é erro de configuração", () => {
    const env = { WHATSAPP_PROVIDER: "akg", AKG_BASE_URL: "https://akg.exemplo.invalid", AKG_API_KEY: "k-teste" };
    expect(createWhatsAppProvider(env)).toBeInstanceOf(AkgProvider);
    expect(() => createWhatsAppProvider({ ...env, AKG_API_KEY: undefined })).toThrow(expect.objectContaining({ code: "misconfigured" }));
    expect(() => createWhatsAppProvider({ ...env, AKG_BASE_URL: undefined })).toThrow(expect.objectContaining({ code: "misconfigured" }));
  });

  it("fake cria FakeProvider", () => {
    expect(createWhatsAppProvider({ WHATSAPP_PROVIDER: "fake" })).toBeInstanceOf(FakeProvider);
  });

  it("getWhatsAppProvider devolve a mesma instância no processo (estado do Fake entre requests)", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "fake");
    const provider = getWhatsAppProvider();
    const { sessionId } = await provider.connect();
    expect(getWhatsAppProvider()).toBe(provider);
    expect((await getWhatsAppProvider().getStatus(sessionId)).state).toBe("qr_pending");
    resetWhatsAppProvider();
    expect(getWhatsAppProvider()).not.toBe(provider);
  });
});
