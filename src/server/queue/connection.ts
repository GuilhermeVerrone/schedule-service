import { Redis, type RedisOptions } from "ioredis";

// Conexão com o Redis das filas BullMQ (D1). A URL vem só de REDIS_URL (com a senha embutida) e
// nunca é logada. Este módulo não importa nada do Next: o worker roda fora do contexto de request.

export function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL não definida");
  return url;
}

// Conexão para Worker e QueueEvents: o BullMQ exige maxRetriesPerRequest nulo nas conexões
// bloqueantes (comandos esperam o Redis voltar em vez de falhar).
export function createWorkerConnection(url: string = redisUrl()): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

// Conexão para quem enfileira (Queue) e para a checagem de saúde: falha rápido com o Redis fora
// do ar (D12), em vez de enfileirar o comando em memória e esperar.
export function createProducerConnection(url: string = redisUrl(), options: RedisOptions = {}): Redis {
  return new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, ...options });
}

export type RedisHealth = { status: "up"; latencyMs: number } | { status: "down"; error: string };

// PING com prazo curto e conexão própria, fechada ao fim. O erro devolvido é só a classe da
// falha (sem URL, host ou senha).
export async function checkRedis(
  url: string | undefined = process.env.REDIS_URL,
  timeoutMs = 2_000,
): Promise<RedisHealth> {
  if (!url) return { status: "down", error: "not_configured" };
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: timeoutMs,
    retryStrategy: () => null,
  });
  // A recusa de senha chega pelo evento "error"; a promessa só diz "Connection is closed".
  let lastError: unknown;
  client.on("error", (error) => (lastError = error));
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    await Promise.race([client.connect().then(() => client.ping()), timeout]);
    return { status: "up", latencyMs: Date.now() - started };
  } catch (error) {
    return { status: "down", error: healthError(lastError ?? error) };
  } finally {
    clearTimeout(timer);
    client.disconnect();
  }
}

function healthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "timeout") return "timeout";
  if (/NOAUTH|WRONGPASS|AUTH/i.test(message)) return "auth";
  return "unreachable";
}
