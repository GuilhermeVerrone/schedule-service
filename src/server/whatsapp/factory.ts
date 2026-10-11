import { AkgProvider } from "./akg-provider";
import { WhatsAppProviderError } from "./errors";
import { FakeProvider } from "./fake-provider";
import type { WhatsAppProvider } from "./types";

// Escolhe o provider pela env WHATSAPP_PROVIDER ("akg" ou "fake"). Sem a env, usa o Fake fora
// de produção; em produção a escolha é obrigatória, para nunca cair no Fake sem querer (o E2E,
// que roda `next start`, define "fake" explicitamente).

export const WHATSAPP_PROVIDERS = ["akg", "fake"] as const;
export type WhatsAppProviderKind = (typeof WHATSAPP_PROVIDERS)[number];

type Env = Record<string, string | undefined>;

export function resolveProviderKind(env: Env = process.env): WhatsAppProviderKind {
  const value = env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (!value) {
    if (env.NODE_ENV === "production") {
      throw new WhatsAppProviderError("misconfigured", "WHATSAPP_PROVIDER não definida.");
    }
    return "fake";
  }
  if (!(WHATSAPP_PROVIDERS as readonly string[]).includes(value)) {
    throw new WhatsAppProviderError("misconfigured", "WHATSAPP_PROVIDER deve ser akg ou fake.");
  }
  return value as WhatsAppProviderKind;
}

export function createWhatsAppProvider(env: Env = process.env): WhatsAppProvider {
  if (resolveProviderKind(env) === "akg") {
    return new AkgProvider({ baseUrl: env.AKG_BASE_URL ?? "", apiKey: env.AKG_API_KEY ?? "" });
  }
  return new FakeProvider();
}

// Uma instância por processo (o Fake guarda sessões em memória; no dev do Next, o globalThis
// sobrevive ao recarregamento dos módulos).
const globalForWhatsApp = globalThis as typeof globalThis & { slotzWhatsAppProvider?: WhatsAppProvider };

export function getWhatsAppProvider(): WhatsAppProvider {
  globalForWhatsApp.slotzWhatsAppProvider ??= createWhatsAppProvider();
  return globalForWhatsApp.slotzWhatsAppProvider;
}

// Só testes: descarta a instância do processo.
export function resetWhatsAppProvider(): void {
  delete globalForWhatsApp.slotzWhatsAppProvider;
}
