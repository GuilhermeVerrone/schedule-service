import { afterEach, describe, expect, it, vi } from "vitest";
import { TENANT_ID_HEADER } from "@/server/auth/context";
import { GET as healthRoute } from "@/app/api/health/route";
import { checkRedis } from "@/server/queue/connection";
import { apiRequest, throughProxy } from "./helpers/auth";

// Rota de saúde (D2) e checagem do Redis (D1, D12). O Redis é o local dos testes
// (docker-compose.test.yml); REDIS_URL aponta para ele (vitest.config.ts).

// connection() só existe dentro de um pedido do Next; fora dele (chamada direta) vira no-op.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const testRedisUrl = process.env.TEST_REDIS_URL as string;
// Porta sem nada escutando e senha errada no Redis certo.
const unreachableUrl = "redis://:x@127.0.0.1:1";
const wrongPasswordUrl = testRedisUrl.replace(/:\/\/:[^@]*@/, "://:senha-errada@");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkRedis", () => {
  it("Redis no ar: up, com latência", async () => {
    const health = await checkRedis(testRedisUrl);
    expect(health.status).toBe("up");
  });

  it("Redis fora do ar: down rápido, sem expor URL nem senha", async () => {
    const started = Date.now();
    const health = await checkRedis(unreachableUrl, 1_000);
    expect(health).toEqual({ status: "down", error: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("senha errada: down por autenticação", async () => {
    expect(wrongPasswordUrl).not.toBe(testRedisUrl);
    expect(await checkRedis(wrongPasswordUrl)).toEqual({ status: "down", error: "auth" });
  });

  it("sem REDIS_URL: down not_configured, sem lançar", async () => {
    expect(await checkRedis("")).toEqual({ status: "down", error: "not_configured" });
  });
});

describe("GET /api/health", () => {
  it("é pública: o proxy deixa passar sem sessão e sem tenantId", async () => {
    for (const path of ["/api/health", "/api/health/"]) {
      const { proxyResponse, forwarded } = await throughProxy(apiRequest(path, { headers: { [TENANT_ID_HEADER]: "forjado" } }));
      expect(proxyResponse.status).toBe(200);
      expect(forwarded?.headers.get(TENANT_ID_HEADER)).toBeNull();
    }
  });

  it("Redis no ar: 200 ok, sem cache", async () => {
    const response = await healthRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", checks: { redis: "up" } });
  });

  it("Redis fora do ar: 503 degraded, sem detalhes de conexão", async () => {
    vi.stubEnv("REDIS_URL", unreachableUrl);
    const response = await healthRoute();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", checks: { redis: "down" } });
    expect(text).not.toContain("127.0.0.1");
  });
});
