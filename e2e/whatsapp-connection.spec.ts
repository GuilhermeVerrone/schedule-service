import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { e2eEmail } from "./accounts";

// Fatia 3 (whatsapp-conexao-mensagens), Fase 6, guia 7a, 7b e 7e no navegador: /painel/whatsapp
// com o FakeProvider (playwright.config.ts). O teste faz o papel do provedor chamando o webhook
// com o segredo gerado na execução: QR lido, queda e suspeita de bloqueio. Um fluxo por viewport,
// com prints. O conteúdo do QR nunca é impresso.

const EVIDENCE_DIR = "docs/features/whatsapp-conexao-mensagens/evidencias";
const STATUS_API = (url: string) => new URL(url).pathname === "/api/whatsapp";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase6-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// Id da sessão no provedor, lido da branch test: é o que o provedor manda no webhook.
async function sessionIdOf(email: string): Promise<string> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ session_id: string }>(
      "SELECT c.session_id FROM whatsapp_connections c JOIN users u ON u.tenant_id = c.tenant_id WHERE u.email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    return rows[0].session_id;
  } finally {
    await client.end();
  }
}

async function providerSays(provider: APIRequestContext, sessionId: string, state: string, reason: string | null = null) {
  const response = await provider.post("/api/webhooks/whatsapp", {
    headers: { "x-webhook-secret": process.env.E2E_WHATSAPP_WEBHOOK_SECRET! },
    data: { type: "connection", sessionId, state, reason, timestamp: new Date().toISOString() },
  });
  expect(response.status()).toBe(200);
}

const qrPath = (page: Page) => page.getByRole("img", { name: "Código QR para conectar o WhatsApp" }).locator("path");

test("whatsapp: aviso, conectar por QR, expiração, queda, bloqueio, reconectar, desconectar e polling", async ({ page, playwright, baseURL }) => {
  test.setTimeout(300_000);
  const project = test.info().project.name;
  const consoleErrors: string[] = [];
  let failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });
  let statusPolls = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && STATUS_API(request.url())) statusPolls += 1;
  });
  const provider = await playwright.request.newContext({ baseURL });

  const email = e2eEmail();
  const register = await page.request.post("/api/auth/register", {
    data: { businessName: `Estúdio WhatsApp ${project}`, email, password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);

  await test.step("carregando e erro: a primeira consulta falha e 'Tentar de novo' resolve", async () => {
    await page.goto("/painel");
    let failOnce = true;
    await page.route(
      (url) => url.pathname === "/api/whatsapp",
      async (route) => {
        if (!failOnce) return route.fallback();
        failOnce = false;
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "internal", message: "Algo deu errado do nosso lado. Tente de novo em instantes." } }),
        });
      },
    );
    const navLink = page.getByRole("link", { name: "WhatsApp", exact: true }).locator("visible=true");
    await navLink.click();
    await expect(page.getByRole("heading", { level: 1, name: "WhatsApp" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Carregando a conexão do WhatsApp…" })).toBeAttached();
    await shot(page, "carregando");
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar." })).toBeVisible();
    await expect(navLink).toHaveAttribute("aria-current", "page");
    await shot(page, "erro");
    await page.unroute((url) => url.pathname === "/api/whatsapp");
    failedResponses = [];
    await page.getByRole("button", { name: "Tentar de novo" }).click();
  });

  await test.step("vazio: aviso de risco e conectar", async () => {
    await expect(page.getByRole("heading", { name: "Seu WhatsApp ainda não está conectado" })).toBeVisible();
    const risk = page.getByRole("complementary", { name: "Risco de bloqueio do número" });
    await expect(risk).toBeVisible();
    await expect(risk).toContainText("não oficial");
    await expect(risk).toContainText("Use o número do negócio");
    await expectNoHorizontalScroll(page);
    await shot(page, "vazio");
  });

  let sessionId = "";
  await test.step("conectar: QR com contagem regressiva", async () => {
    await page.getByRole("button", { name: "Conectar WhatsApp" }).click();
    await expect(page.getByRole("heading", { name: "Leia o código com o celular do negócio" })).toBeVisible();
    await expect(qrPath(page)).toHaveAttribute("d", /^M/);
    await expect(page.getByText(/O código expira em 0:[0-5]\d|O código expira em 1:00/)).toBeVisible();
    await expect(page.locator("[data-status='qr_pending']")).toHaveText("Aguardando leitura");
    await expectNoHorizontalScroll(page);
    await shot(page, "qr");
    sessionId = await sessionIdOf(email);
  });

  await test.step("o QR expira e é trocado sozinho por um novo", async () => {
    const first = await qrPath(page).getAttribute("d");
    // FakeProvider: QR de 60 s, trocado quando vence; a tela consulta a cada 3 s.
    await expect.poll(() => qrPath(page).getAttribute("d"), { timeout: 80_000, intervals: [2_000] }).not.toBe(first);
    await expect(page.getByText(/O código expira em (0:[3-5]\d|1:00)/)).toBeVisible();
    await expect(page.getByText("Código expirado")).toHaveCount(0);
  });

  await test.step("o celular lê o QR: a tela mostra conectado sem recarregar", async () => {
    await providerSays(provider, sessionId, "connected");
    await expect(page.getByRole("heading", { name: "As mensagens dos clientes estão chegando" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-status='connected']")).toHaveText("Conectado");
    await expect(page.getByText(/Última verificação às \d{2}:\d{2}\./)).toBeVisible();
    await expect(qrPath(page)).toHaveCount(0);
    await shot(page, "conectado");
  });

  await test.step("queda: alerta e reconectar com QR novo", async () => {
    await providerSays(provider, sessionId, "disconnected", "connection_lost");
    // Fora do QR, o polling é de 15 s.
    await expect(page.getByRole("heading", { name: "A conexão com o WhatsApp caiu" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("alert").filter({ hasText: "não chegam ao Slotz" })).toBeVisible();
    await expect(page.locator("[data-status='disconnected']")).toHaveText("Desconectado");
    await expectNoHorizontalScroll(page);
    await shot(page, "queda");

    await page.getByRole("button", { name: "Reconectar" }).click();
    await expect(page.getByRole("heading", { name: "Leia o código com o celular do negócio" })).toBeVisible();
    await expect(qrPath(page)).toHaveAttribute("d", /^M/);
    expect(await sessionIdOf(email)).toBe(sessionId);
    await shot(page, "reconectar-qr");
    await providerSays(provider, sessionId, "connected");
    await expect(page.locator("[data-status='connected']")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("suspeita de bloqueio: alerta próprio e reconectar", async () => {
    await providerSays(provider, sessionId, "banned_suspected", "banned");
    await expect(page.getByRole("heading", { name: "O WhatsApp pode ter bloqueado este número" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("alert").filter({ hasText: "aviso de bloqueio" })).toBeVisible();
    await expect(page.locator("[data-status='banned_suspected']")).toHaveText("Possível bloqueio");
    await shot(page, "bloqueio");
    await page.getByRole("button", { name: "Reconectar" }).click();
    await expect(qrPath(page)).toHaveAttribute("d", /^M/);
    await providerSays(provider, sessionId, "connected");
    await expect(page.locator("[data-status='connected']")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("desconectar: confirmação, voltar e confirmar", async () => {
    await page.getByRole("button", { name: "Desconectar", exact: true }).click();
    const confirm = page.getByRole("group", { name: "Confirmar desconexão" });
    await expect(confirm).toContainText("param de chegar ao Slotz");
    await shot(page, "desconectar-confirmacao");
    await confirm.getByRole("button", { name: "Voltar" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.locator("[data-status='connected']")).toBeVisible();

    await page.getByRole("button", { name: "Desconectar", exact: true }).click();
    await confirm.getByRole("button", { name: "Sim, desconectar" }).click();
    await expect(page.getByRole("heading", { name: "Você desconectou o WhatsApp" })).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "WhatsApp desconectado." })).toBeVisible();
    // Desconectar por escolha do dono não é queda: sem alerta.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-status='disconnected']")).toBeVisible();
    await shot(page, "desconectado");
    const status = await page.request.get("/api/whatsapp");
    expect((await status.json()).connection.status).toBe("disconnected");
  });

  await test.step("polling: pausa com a aba escondida e para ao sair da tela", async () => {
    await page.getByRole("button", { name: "Conectar de novo" }).click();
    await expect(qrPath(page)).toHaveAttribute("d", /^M/);
    const start = statusPolls;
    await expect.poll(() => statusPolls - start, { timeout: 12_000 }).toBeGreaterThanOrEqual(2);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
    const hidden = statusPolls;
    await page.waitForTimeout(7_000);
    expect(statusPolls).toBe(hidden);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => statusPolls, { timeout: 3_000 }).toBeGreaterThan(hidden);

    await page.getByRole("link", { name: "Agenda", exact: true }).locator("visible=true").click();
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await page.waitForTimeout(500);
    const left = statusPolls;
    await page.waitForTimeout(8_000);
    expect(statusPolls).toBe(left);
  });

  await provider.dispose();
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
