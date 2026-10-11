import { clientIp } from "@/server/auth/client-ip";
import { createRateLimitRepository, type RateLimitRepository } from "@/server/repositories/rate-limit-repository";

// Limites por IP das rotas públicas (D8). Leitura (site, horários, ver o agendamento) é folgada
// para a navegação normal; escrita (agendar, cancelar, remarcar) é curta contra spam de
// agendamentos falsos, já que não há verificação de contato (decisão 5, risco aceito). O webhook
// do WhatsApp (D8) recebe de poucos IPs do provedor, com rajadas de mensagens de todos os tenants
// da instância: teto alto, que só barra quem martela a rota tentando adivinhar o segredo.

export const PUBLIC_RATE_LIMITS = {
  read: { bucket: "public_read", max: 120, windowMs: 60 * 1000 },
  write: { bucket: "public_write", max: 10, windowMs: 10 * 60 * 1000 },
  whatsappWebhook: { bucket: "whatsapp_webhook", max: 600, windowMs: 60 * 1000 },
} as const;

export type PublicRateLimit = keyof typeof PUBLIC_RATE_LIMITS;

export async function allowPublicRequest(
  kind: PublicRateLimit,
  headers: Headers,
  repo: RateLimitRepository = createRateLimitRepository(),
): Promise<boolean> {
  const { bucket, max, windowMs } = PUBLIC_RATE_LIMITS[kind];
  return repo.hit({ bucket, key: clientIp(headers), max, windowMs });
}

export function retryAfterSeconds(kind: PublicRateLimit): number {
  return Math.ceil(PUBLIC_RATE_LIMITS[kind].windowMs / 1000);
}
