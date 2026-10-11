import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerConnection } from "@/server/queue/connection";
import { runPing, startWorker, type WorkerHandle } from "@/worker/runtime";

// Integração do worker com o Redis local dos testes (docker-compose.test.yml): conecta, processa
// o job de teste e encerra limpo (Fase 1). Também confere a configuração exigida em D1.

const root = fileURLToPath(new URL("..", import.meta.url));
const testRedisUrl = process.env.TEST_REDIS_URL as string;
const silent = () => {};

describe("worker BullMQ", () => {
  let handle: WorkerHandle;

  beforeAll(async () => {
    handle = await startWorker(testRedisUrl, silent);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("conecta ao Redis e está saudável", async () => {
    expect(handle.worker.isRunning()).toBe(true);
    expect(await handle.isHealthy()).toBe(true);
  });

  it("processa o job de teste (ping) e devolve o resultado", async () => {
    const before = new Date().toISOString();
    const result = await runPing(testRedisUrl);
    expect(result.pong).toBe(true);
    expect(result.requestedAt >= before).toBe(true);
    expect(result.processedAt >= result.requestedAt).toBe(true);
  });

  it("processa vários jobs seguidos", async () => {
    const results = await Promise.all([1, 2, 3].map(() => runPing(testRedisUrl)));
    expect(results.every((r) => r.pong)).toBe(true);
  });

  it("encerra limpo: close é idempotente e o worker para de rodar", async () => {
    const other = await startWorker(testRedisUrl, silent);
    await Promise.all([other.close(), other.close()]);
    expect(other.worker.isRunning()).toBe(false);
    expect(await other.isHealthy()).toBe(false);
  });
});

describe("Redis exige senha e não descarta chaves", () => {
  it("sem senha: NOAUTH", async () => {
    const noAuth = createWorkerConnection(testRedisUrl.replace(/:\/\/:[^@]*@/, "://"));
    noAuth.on("error", () => {});
    try {
      await expect(noAuth.ping()).rejects.toThrow(/NOAUTH/);
    } finally {
      noAuth.disconnect();
    }
  });

  it("maxmemory-policy noeviction (D1)", async () => {
    const client = createWorkerConnection(testRedisUrl);
    try {
      expect(await client.config("GET", "maxmemory-policy")).toEqual(["maxmemory-policy", "noeviction"]);
    } finally {
      await client.quit();
    }
  });
});

describe("pnpm worker:smoke", () => {
  it("sobe o worker como processo separado, processa o job de teste e sai com 0", async () => {
    const { stdout } = await promisify(execFile)("pnpm", ["worker:smoke"], {
      cwd: root,
      env: { ...process.env, REDIS_URL: testRedisUrl },
      timeout: 30_000,
    });
    const events = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line).event);
    expect(events).toEqual(["worker_ready", "job_completed", "smoke_ok", "worker_closed"]);
    expect(stdout).not.toContain(testRedisUrl);
  }, 40_000);
});
