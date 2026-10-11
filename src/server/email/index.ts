// Porta de entrada do e-mail para o produto. Fora de src/server/email/ só se importa daqui, e
// nada aqui expõe o provedor concreto (o teste de varredura garante que o Resend não aparece fora
// deste diretório).
export * from "./types";
export { EmailProviderError, isEmailError, type EmailErrorCode } from "./errors";
export { getEmailProvider, resetEmailProvider } from "./factory";
export { FakeEmailProvider, type FakeSentEmail } from "./fake-provider";
export { fromAddress, resolveFromDomain } from "./address";
