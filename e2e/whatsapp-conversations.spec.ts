import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { e2eEmail } from "./accounts";

// Fatia 3 (whatsapp-conexao-mensagens), Fase 7, guia 7c e 7d no navegador: /painel/conversas com
// o FakeProvider (playwright.config.ts). O teste faz o papel do provedor chamando o webhook com o
// segredo da execução: mensagens de texto, imagem e áudio chegam e a tela mostra sem recarregar.
// Dois negócios por viewport: as conversas do outro nunca aparecem. Um fluxo por viewport, com prints.

const EVIDENCE_DIR = "docs/features/whatsapp-conexao-mensagens/evidencias";
const LIST_API = (url: string) => new URL(url).pathname === "/api/conversations";
const SECRET = () => process.env.E2E_WHATSAPP_WEBHOOK_SECRET!;

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase7-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function query<T extends object>(sql: string, params: unknown[]): Promise<T[]> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

// Id da sessão no provedor, lido da branch test: é o que o provedor manda no webhook.
async function sessionIdOf(email: string): Promise<string> {
  const rows = await query<{ session_id: string }>(
    "SELECT c.session_id FROM whatsapp_connections c JOIN users u ON u.tenant_id = c.tenant_id WHERE u.email = $1",
    [email],
  );
  expect(rows).toHaveLength(1);
  return rows[0].session_id;
}

async function conversationIdOf(email: string, phone: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT cv.id FROM conversations cv
       JOIN contacts ct ON ct.id = cv.contact_id AND ct.tenant_id = cv.tenant_id
       JOIN users u ON u.tenant_id = cv.tenant_id
      WHERE u.email = $1 AND ct.phone = $2`,
    [email, phone],
  );
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function webhook(provider: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const response = await provider.post("/api/webhooks/whatsapp", { headers: { "x-webhook-secret": SECRET() }, data });
  expect(response.status()).toBe(200);
}

interface Inbound {
  from: string;
  profileName?: string;
  text?: string;
  mediaType?: "image" | "audio";
  timestamp?: string;
  messageId?: string;
}

// Mensagem recebida no formato do webhook do FakeProvider. O id é único por execução: o evento
// do webhook é único por provedor (D8), então ids fixos colidiriam entre execuções.
async function clientWrites(provider: APIRequestContext, sessionId: string, message: Inbound): Promise<string> {
  const messageId = message.messageId ?? `e2e-${randomUUID()}`;
  await webhook(provider, {
    type: "message",
    sessionId,
    messageId,
    from: message.from,
    profileName: message.profileName ?? null,
    text: message.text ?? null,
    mediaType: message.mediaType ?? null,
    timestamp: message.timestamp ?? new Date().toISOString(),
  });
  return messageId;
}

// Negócio com o WhatsApp conectado pelo FakeProvider: conecta (QR) e o provedor avisa a leitura.
async function connectedBusiness(request: APIRequestContext, provider: APIRequestContext, businessName: string) {
  const email = e2eEmail();
  const register = await request.post("/api/auth/register", { data: { businessName, email, password: "senha-forte-123" } });
  expect(register.status()).toBe(201);
  expect((await request.post("/api/whatsapp/connect")).status()).toBe(200);
  const sessionId = await sessionIdOf(email);
  await webhook(provider, { type: "connection", sessionId, state: "connected", reason: null, timestamp: new Date().toISOString() });
  return { email, sessionId };
}

const MARIANA = "+5511987654321";
const SEM_NOME = "+5521998765432";
const PAGINADO = "+5531991234567";
const OUTRO = "+5511911112222";

test("conversas: chegada pelo webhook, lista, leitura, mídia, paginação e isolamento entre negócios", async ({ page, playwright, baseURL }) => {
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
  let listPolls = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && LIST_API(request.url())) listPolls += 1;
  });
  const provider = await playwright.request.newContext({ baseURL });
  const other = await playwright.request.newContext({ baseURL });

  const mine = await connectedBusiness(page.request, provider, `Estúdio Conversas ${project}`);
  const theirs = await connectedBusiness(other, provider, `Outro Negócio ${project}`);

  await test.step("carregando e erro: a primeira consulta falha e 'Tentar de novo' resolve", async () => {
    await page.goto("/painel");
    let failOnce = true;
    await page.route(
      (url) => LIST_API(url.href),
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
    const navLink = page.getByRole("link", { name: "Conversas", exact: true }).locator("visible=true");
    await navLink.click();
    await expect(page.getByRole("heading", { level: 1, name: "Conversas" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Carregando conversas…" })).toBeAttached();
    await shot(page, "carregando");
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar." })).toBeVisible();
    await expect(navLink).toHaveAttribute("aria-current", "page");
    await shot(page, "erro");
    await page.unroute((url) => LIST_API(url.href));
    failedResponses = [];
    await page.getByRole("button", { name: "Tentar de novo" }).click();
  });

  await test.step("vazio: nenhuma conversa e atalho para a conexão", async () => {
    await expect(page.getByRole("heading", { name: "Nenhuma conversa ainda" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver conexão do WhatsApp" })).toHaveAttribute("href", "/painel/whatsapp");
    await expectNoHorizontalScroll(page);
    await shot(page, "vazio");
  });

  await test.step("o outro negócio recebe mensagem: não aparece aqui", async () => {
    await clientWrites(provider, theirs.sessionId, { from: OUTRO, profileName: "Cliente Do Outro", text: "Mensagem do outro negócio" });
    const start = listPolls;
    // A lista consulta a cada 15 s: espera uma consulta de fundo e confere que segue vazia.
    await expect.poll(() => listPolls - start, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "Nenhuma conversa ainda" })).toBeVisible();
    await expect(page.getByText("Cliente Do Outro")).toHaveCount(0);
  });

  let duplicateId = "";
  await test.step("chegada pelo webhook: as conversas aparecem na lista sem recarregar", async () => {
    const base = Date.now();
    const at = (seconds: number) => new Date(base - 60_000 + seconds * 1_000).toISOString();
    await clientWrites(provider, mine.sessionId, { from: SEM_NOME, text: "Bom dia, vocês abrem sábado?", timestamp: at(0) });
    duplicateId = await clientWrites(provider, mine.sessionId, {
      from: MARIANA,
      profileName: "Mariana Souza",
      text: "Oi! Vocês têm horário amanhã à tarde?\nPode ser depois das 15h.",
      timestamp: at(10),
    });
    await clientWrites(provider, mine.sessionId, { from: MARIANA, profileName: "Mariana Souza", mediaType: "image", text: "Esse é o corte que eu quero", timestamp: at(20) });
    await clientWrites(provider, mine.sessionId, { from: MARIANA, profileName: "Mariana Souza", mediaType: "audio", timestamp: at(30) });
    // O provedor reenvia a primeira mensagem da Mariana: grava uma vez só.
    await clientWrites(provider, mine.sessionId, {
      from: MARIANA,
      profileName: "Mariana Souza",
      text: "Oi! Vocês têm horário amanhã à tarde?\nPode ser depois das 15h.",
      timestamp: at(10),
      messageId: duplicateId,
    });

    const list = page.getByRole("list", { name: "Conversas" });
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    // A mais recente (Mariana, último envio um áudio) fica em cima.
    const first = list.getByRole("listitem").first();
    await expect(first).toContainText("Mariana Souza");
    await expect(first).toContainText("[áudio]");
    await expect(first.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    const second = list.getByRole("listitem").nth(1);
    await expect(second).toContainText("(21) 99876-5432");
    await expect(second).toContainText("Bom dia, vocês abrem sábado?");
    await expect(page.getByText("Cliente Do Outro")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "lista");
  });

  await test.step("leitura da conversa: texto, [imagem], [áudio], somente leitura", async () => {
    await page.getByRole("link", { name: /Mariana Souza/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mariana Souza" })).toBeVisible();
    await expect(page.getByText("(11) 98765-4321")).toBeVisible();
    const transcript = page.getByRole("region", { name: "Mensagens" });
    const bubbles = transcript.locator("li[data-direction]");
    await expect(bubbles).toHaveCount(3);
    await expect(bubbles.nth(0)).toContainText("Oi! Vocês têm horário amanhã à tarde?");
    await expect(bubbles.nth(0)).toContainText("Pode ser depois das 15h.");
    await expect(bubbles.nth(1)).toContainText("[imagem] Esse é o corte que eu quero");
    await expect(bubbles.nth(2)).toContainText("[áudio]");
    await expect(bubbles.nth(2).locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(transcript.getByRole("listitem", { name: "Hoje" })).toBeAttached();
    await expect(transcript).toContainText("Para responder, use o WhatsApp no celular do negócio.");
    // Somente leitura (D6): nenhum campo de texto nem botão de enviar.
    await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: /enviar|responder/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mensagens anteriores" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "conversa");
  });

  await test.step("mensagem nova chega com a conversa aberta", async () => {
    await clientWrites(provider, mine.sessionId, { from: MARIANA, profileName: "Mariana Souza", text: "Consegue às 16h?" });
    const bubbles = page.getByRole("region", { name: "Mensagens" }).locator("li[data-direction]");
    await expect(bubbles).toHaveCount(4, { timeout: 20_000 });
    await expect(bubbles.last()).toContainText("Consegue às 16h?");
    await expect(bubbles.last()).toBeInViewport();
    await shot(page, "conversa-nova-mensagem");
  });

  await test.step("50 mensagens por página: 'Mensagens anteriores' traz o resto", async () => {
    // 52 mensagens de ontem a partir das 12h (fuso do negócio), um minuto entre cada; a 1ª página
    // traz as 50 mais recentes.
    const yesterday = DateTime.now().setZone("America/Sao_Paulo").startOf("day").minus({ hours: 12 }).toMillis();
    for (let index = 1; index <= 52; index += 1) {
      await clientWrites(provider, mine.sessionId, {
        from: PAGINADO,
        profileName: "Paulo Lima",
        text: `Mensagem ${index}`,
        timestamp: new Date(yesterday + index * 60_000).toISOString(),
      });
    }
    await page.goto(`/painel/conversas/${await conversationIdOf(mine.email, PAGINADO)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Paulo Lima" })).toBeVisible();
    const bubbles = page.getByRole("region", { name: "Mensagens" }).locator("li[data-direction]");
    await expect(bubbles).toHaveCount(50);
    await expect(bubbles.first().locator("p")).toHaveText("Mensagem 3");
    await expect(bubbles.last().locator("p")).toHaveText("Mensagem 52");
    await expect(page.getByRole("region", { name: "Mensagens" }).getByRole("listitem", { name: "Ontem" })).toBeAttached();
    await shot(page, "paginacao");
    await page.getByRole("button", { name: "Mensagens anteriores" }).click();
    await expect(bubbles).toHaveCount(52);
    await expect(bubbles.first().locator("p")).toHaveText("Mensagem 1");
    await expect(page.getByRole("button", { name: "Mensagens anteriores" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  await test.step("isolamento: a conversa do outro negócio não abre aqui, nem pela URL", async () => {
    const otherId = await conversationIdOf(theirs.email, OUTRO);
    failedResponses = [];
    await page.goto(`/painel/conversas/${otherId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Conversa não encontrada" })).toBeVisible();
    await expect(page.getByText("Mensagem do outro negócio")).toHaveCount(0);
    expect(failedResponses).toEqual([`404 GET /api/conversations/${otherId}/messages`]);
    failedResponses = [];
    await shot(page, "outro-negocio");

    await page.getByRole("link", { name: "Ver conversas" }).click();
    const list = page.getByRole("list", { name: "Conversas" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByRole("listitem").first()).toContainText("Mariana Souza");
    await expect(page.getByText("Cliente Do Outro")).toHaveCount(0);

    // E o outro negócio só vê a própria conversa.
    const theirList = await (await other.get("/api/conversations")).json();
    expect(theirList.conversations.items.map((item: { contact: { name: string } }) => item.contact.name)).toEqual(["Cliente Do Outro"]);
  });

  await test.step("a lista para de consultar ao sair da tela", async () => {
    await page.getByRole("link", { name: "Agenda", exact: true }).locator("visible=true").click();
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await page.waitForTimeout(500);
    const left = listPolls;
    await page.waitForTimeout(16_000);
    expect(listPolls).toBe(left);
  });

  await provider.dispose();
  await other.dispose();
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
