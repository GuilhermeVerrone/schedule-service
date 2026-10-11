import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Limite de requisições das rotas públicas (D8), pré-tenant como login_attempts: por balde
// (ex.: "public_write") e chave (IP), em janela móvel. Cada pedido grava um registro antes de
// contar, então pedidos simultâneos se enxergam e nenhum passa por fora da conta.

export interface RateLimitCheck {
  bucket: string;
  key: string;
  max: number;
  windowMs: number;
}

export function createRateLimitRepository(db: PrismaClient = prisma) {
  return {
    // true se o pedido cabe no limite. O pedido recusado também conta (quem insiste continua barrado).
    async hit({ bucket, key, max, windowMs }: RateLimitCheck, now: Date = new Date()): Promise<boolean> {
      const since = new Date(now.getTime() - windowMs);
      await db.rateLimitHit.create({ data: { bucket, key, createdAt: now } });
      const [count] = await Promise.all([
        db.rateLimitHit.count({ where: { bucket, key, createdAt: { gt: since } } }),
        // Faxina do próprio balde/chave: o que saiu da janela não serve mais.
        db.rateLimitHit.deleteMany({ where: { bucket, key, createdAt: { lte: since } } }),
      ]);
      return count <= max;
    },
  };
}

export type RateLimitRepository = ReturnType<typeof createRateLimitRepository>;
