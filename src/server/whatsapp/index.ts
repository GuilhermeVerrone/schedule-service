// Porta de entrada do WhatsApp para o produto. Fora de src/server/whatsapp/ só se importa daqui,
// e nada aqui expõe o provedor concreto (o teste de varredura garante que o AKG não aparece
// fora deste diretório).
export * from "./types";
export { WhatsAppProviderError, isWhatsAppError, type WhatsAppErrorCode } from "./errors";
export { getWhatsAppProvider, resetWhatsAppProvider } from "./factory";
export { FakeProvider, type FakeSentMessage, type FakeWebhookPayload } from "./fake-provider";
