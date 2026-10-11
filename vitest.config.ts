import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL não definida (branch test do Neon)");
if (!process.env.TEST_DIRECT_URL) throw new Error("TEST_DIRECT_URL não definida (branch test do Neon)");
const testRedisUrl = process.env.TEST_REDIS_URL;
if (!testRedisUrl) throw new Error("TEST_REDIS_URL não definida (Redis local: pnpm redis:test:up)");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["tests/setup/migrate-test-db.ts", "tests/setup/check-test-redis.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Os testes nunca tocam a branch dev: DATABASE_URL aponta para a branch test. O Redis é o
    // local de docker-compose.test.yml, nunca o do Compose do app.
    env: { DATABASE_URL: testDatabaseUrl, REDIS_URL: testRedisUrl },
  },
});
