import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

// Concorrência por tenant (impacto "Performance"): o worker processa vários tenants em paralelo,
// mas um número só envia uma mensagem por vez. A trava é uma chave no Redis com dono (token) e
// prazo; quem não pega a trava adia o job, sem ocupar o worker. O fim do intervalo aleatório
// desde o último envio (D3) também fica aqui, compartilhado entre workers.

const LOCK_TTL_MS = 60_000;
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface TenantThrottle {
  acquire(tenantId: string): Promise<string | null>;
  release(tenantId: string, token: string): Promise<void>;
  getNotBefore(tenantId: string): Promise<Date | null>;
  setNotBefore(tenantId: string, at: Date): Promise<void>;
}

export function createTenantThrottle(redis: Redis, prefix = "slotz"): TenantThrottle {
  const key = (tenantId: string, name: string) => `${prefix}:outbound:tenant:${tenantId}:${name}`;
  return {
    async acquire(tenantId) {
      const token = randomUUID();
      const ok = await redis.set(key(tenantId, "lock"), token, "PX", LOCK_TTL_MS, "NX");
      return ok === "OK" ? token : null;
    },
    async release(tenantId, token) {
      await redis.eval(RELEASE, 1, key(tenantId, "lock"), token);
    },
    async getNotBefore(tenantId) {
      const value = await redis.get(key(tenantId, "not-before"));
      return value ? new Date(Number(value)) : null;
    },
    // A chave expira sozinha um pouco depois do prazo.
    async setNotBefore(tenantId, at) {
      const ttl = Math.max(1, at.getTime() - Date.now()) + 60_000;
      await redis.set(key(tenantId, "not-before"), String(at.getTime()), "PX", ttl);
    },
  };
}
