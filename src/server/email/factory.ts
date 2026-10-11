import { EmailProviderError } from "./errors";
import { FakeEmailProvider } from "./fake-provider";
import { ResendEmailProvider } from "./resend-provider";
import type { EmailProvider } from "./types";

// Escolhe o provedor pela env EMAIL_PROVIDER ("resend" ou "fake"), como o do WhatsApp: sem a env,
// usa o Fake fora de produção; em produção a escolha é obrigatória, para nunca cair no Fake sem
// querer.

export const EMAIL_PROVIDERS = ["resend", "fake"] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDERS)[number];

type Env = Record<string, string | undefined>;

export function resolveEmailProviderKind(env: Env = process.env): EmailProviderKind {
  const value = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!value) {
    if (env.NODE_ENV === "production") {
      throw new EmailProviderError("misconfigured", "EMAIL_PROVIDER não definida.");
    }
    return "fake";
  }
  if (!(EMAIL_PROVIDERS as readonly string[]).includes(value)) {
    throw new EmailProviderError("misconfigured", "EMAIL_PROVIDER deve ser resend ou fake.");
  }
  return value as EmailProviderKind;
}

export function createEmailProvider(env: Env = process.env): EmailProvider {
  if (resolveEmailProviderKind(env) === "resend") return new ResendEmailProvider({ apiKey: env.RESEND_API_KEY ?? "" });
  return new FakeEmailProvider();
}

// Uma instância por processo.
const globalForEmail = globalThis as typeof globalThis & { slotzEmailProvider?: EmailProvider };

export function getEmailProvider(): EmailProvider {
  globalForEmail.slotzEmailProvider ??= createEmailProvider();
  return globalForEmail.slotzEmailProvider;
}

// Só testes: descarta a instância do processo.
export function resetEmailProvider(): void {
  delete globalForEmail.slotzEmailProvider;
}
