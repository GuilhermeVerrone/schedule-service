import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL não definida (branch test do Neon)");
if (!process.env.TEST_DIRECT_URL) throw new Error("TEST_DIRECT_URL não definida (branch test do Neon)");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["tests/setup/migrate-test-db.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Os testes nunca tocam a branch dev: DATABASE_URL aponta para a branch test.
    env: { DATABASE_URL: testDatabaseUrl },
  },
});
