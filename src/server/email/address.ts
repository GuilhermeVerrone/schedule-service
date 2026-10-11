import { EmailProviderError } from "./errors";

// Remetente dos e-mails transacionais. O domínio vem de EMAIL_FROM_DOMAIN (nunca fixo no código:
// o domínio do produto vai mudar), num subdomínio de envio com SPF/DKIM/DMARC (deploy, fora daqui).

// Caixa sem resposta: o cliente final fala com o negócio pelo WhatsApp.
export const EMAIL_FROM_LOCAL_PART = "nao-responda";

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function resolveFromDomain(value: string | undefined = process.env.EMAIL_FROM_DOMAIN): string {
  const domain = value?.trim().toLowerCase() ?? "";
  if (!HOSTNAME.test(domain)) {
    throw new EmailProviderError("misconfigured", "EMAIL_FROM_DOMAIN ausente ou inválido.");
  }
  return domain;
}

// Nome de exibição vindo do nome do negócio (texto do dono): sem quebra de linha nem caracteres
// que mudem o cabeçalho (aspas, <, >, barra invertida), entre aspas.
export function displayName(name: string): string {
  return name
    .replace(/[\p{Cc}\p{Cf}"<>\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 78);
}

export function fromAddress(name: string, domain: string): string {
  const shown = displayName(name);
  const address = `${EMAIL_FROM_LOCAL_PART}@${resolveFromDomain(domain)}`;
  return shown ? `"${shown}" <${address}>` : address;
}
