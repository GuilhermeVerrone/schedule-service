import "dotenv/config";
import { defineConfig } from "@playwright/test";

// E2E das telas no navegador (Fase 5). Sobe `next start` (rode `pnpm build` antes) apontando
// para a branch test do Neon, nunca a dev. Prints vão para a pasta de evidências da feature.

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL não definida (branch test do Neon)");

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Keepalive de TCP só neste servidor de teste (veja e2e/support/tcp-keepalive.cjs).
    env: { DATABASE_URL: testDatabaseUrl, NODE_OPTIONS: "--require ./e2e/support/tcp-keepalive.cjs" },
    stdout: "ignore",
    stderr: "pipe",
  },
});
