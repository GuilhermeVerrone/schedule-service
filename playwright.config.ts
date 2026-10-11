import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// E2E das telas no navegador (Fase 5). Sobe `next start` (rode `pnpm build` antes) apontando
// para a branch test do Neon, nunca a dev. Prints vão para a pasta de evidências da feature.

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL não definida (branch test do Neon)");

const PORT = 3100;

// WhatsApp no E2E (whatsapp-conexao-mensagens, Fase 6): sempre o FakeProvider, e o segredo do
// webhook é gerado a cada execução (nunca vem do .env). Os workers herdam o process.env do runner,
// e o teste usa o mesmo segredo para fazer o papel do provedor chamando o webhook.
process.env.E2E_WHATSAPP_WEBHOOK_SECRET ??= randomBytes(24).toString("hex");

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
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_OPTIONS: "--require ./e2e/support/tcp-keepalive.cjs",
      WHATSAPP_PROVIDER: "fake",
      WHATSAPP_WEBHOOK_SECRET: process.env.E2E_WHATSAPP_WEBHOOK_SECRET,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
