// Confere, antes da suíte, que o Redis local dos testes de integração está no ar
// (docker-compose.test.yml). Sem ele a suíte falha logo, com a instrução, em vez de esperar.
import { checkRedis } from "../../src/server/queue/connection";

export default async function setup(): Promise<void> {
  const redis = await checkRedis(process.env.TEST_REDIS_URL);
  if (redis.status !== "up") {
    throw new Error(`Redis de teste indisponível (${redis.error}). Suba com: pnpm redis:test:up`);
  }
}
