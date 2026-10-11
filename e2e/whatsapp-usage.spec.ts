import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { e2eEmail } from "./accounts";

// Fatia 4 (fila-envio-limites-elegibilidade), Fase 10, guia 3 e 7f (D6) no navegador: bloco só
// leitura de /painel/whatsapp com o uso de hoje, a fase do aquecimento e os envios bloqueados.
// WhatsApp pelo FakeProvider (playwright.config.ts); o teste faz o papel do provedor no webhook e
// grava na branch test o estado que a fila deixaria (contador do dia e envios `blocked`).
// Um fluxo por viewport, com prints.

// A branch test do Neon anda lenta (Fase 9, pendência 2): mais folga para cada leitura da tela.
const expect = baseExpect.configure({ timeout: 30_000 });

const EVIDENCE_DIR = "docs/features/fila-envio-limites-elegibilidade/evidencias";
const USAGE_API = (url: URL) => url.pathname === "/api/whatsapp/usage";
const BLOCKED_API = (url: URL) => url.pathname === "/api/whatsapp/blocked";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase10-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function sql<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function tenantIdOf(email: string): Promise<string> {
  const rows = await sql<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE email = $1", [email]);
  expect(rows).toHaveLength(1);
  return rows[0].tenant_id;
}

async function providerSays(provider: APIRequestContext, sessionId: string, state: string) {
  const response = await provider.post("/api/webhooks/whatsapp", {
    headers: { "x-webhook-secret": process.env.E2E_WHATSAPP_WEBHOOK_SECRET! },
    data: { type: "connection", sessionId, state, reason: null, timestamp: new Date().toISOString() },
  });
  expect(response.status()).toBe(200);
}

// Contador do dia como o worker deixa: `daily_count_date` é hoje no fuso do tenant (D9).
async function setCounter(tenantId: string, daysSinceFirstConnection: number, sentToday: number): Promise<void> {
  await sql(
    `UPDATE whatsapp_connections c
        SET first_connected_at = now() - make_interval(days => $2::int),
            daily_sent_count = $3,
            daily_count_date = (now() AT TIME ZONE t.timezone)::date,
            updated_at = now()
       FROM tenants t
      WHERE t.id = c.tenant_id AND c.tenant_id = $1`,
    [tenantId, daysSinceFirstConnection, sentToday],
  );
}

interface BlockedSeed {
  name: string;
  phone: string;
  reason: string;
  type: "appointment_confirmation" | "optout_confirmation";
  channel: "whatsapp" | "email" | null;
  minutesAgo: number;
}

// Envios bloqueados como o worker grava (status `blocked` + motivo), cada um com contato próprio.
// Uma só consulta para todos (a branch test do Neon é lenta por ida e volta).
async function seedBlocked(tenantId: string, seeds: BlockedSeed[]): Promise<void> {
  await sql(
    `WITH seed AS (
       SELECT gen_random_uuid() AS contact_id, *
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])
           AS s(name, phone, message_type, channel, reason, minutes_ago)
     ),
     contact AS (
       INSERT INTO contacts (id, tenant_id, name, phone, created_at, updated_at)
       SELECT contact_id, $1, name, phone, now(), now() FROM seed
     )
     INSERT INTO outbound_messages
       (id, tenant_id, contact_id, message_type, channel, status, block_reason, idempotency_key, scheduled_for, created_at, updated_at)
     SELECT gen_random_uuid(), $1, contact_id, message_type, channel, 'blocked', reason, 'e2e:' || gen_random_uuid(),
            now() - make_interval(mins => minutes_ago), now() - make_interval(mins => minutes_ago), now() - make_interval(mins => minutes_ago)
       FROM seed`,
    [
      tenantId,
      seeds.map((seed) => seed.name),
      seeds.map((seed) => seed.phone),
      seeds.map((seed) => seed.type),
      seeds.map((seed) => seed.channel),
      seeds.map((seed) => seed.reason),
      seeds.map((seed) => seed.minutesAgo),
    ],
  );
}

const usagePanel = (page: Page) => page.getByRole("region", { name: "Envios de hoje" });
const blockedPanel = (page: Page) => page.getByRole("region", { name: "Envios bloqueados" });
const rows = (panel: Locator) => panel.getByRole("listitem");

test("whatsapp: uso de hoje, aquecimento e envios bloqueados (carregando, erro, vazio, dados, paginação)", async ({ page, playwright, baseURL }) => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const provider = await playwright.request.newContext({ baseURL });

  const email = e2eEmail();
  const register = await page.request.post("/api/auth/register", {
    data: { businessName: `Estúdio Envios ${project}`, email, password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);
  const tenantId = await tenantIdOf(email);

  // Outro tenant com um bloqueio: nunca aparece na tela do primeiro.
  const other = await playwright.request.newContext({ baseURL });
  const otherEmail = e2eEmail();
  expect((await other.post("/api/auth/register", { data: { businessName: "Outro estúdio", email: otherEmail, password: "senha-forte-123" } })).status()).toBe(201);
  await seedBlocked(await tenantIdOf(otherEmail), [
    { name: "Cliente de Outro Tenant", phone: "+5511900000099", reason: "opt_out", type: "appointment_confirmation", channel: "whatsapp", minutesAgo: 1 },
  ]);

  await test.step("carregando e erro: as duas consultas falham e 'Tentar de novo' resolve cada painel", async () => {
    const fail = async (route: import("@playwright/test").Route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "Algo deu errado do nosso lado. Tente de novo em instantes." } }),
      });
    };
    await page.route(USAGE_API, fail);
    await page.route(BLOCKED_API, fail);
    await page.goto("/painel/whatsapp");
    await expect(page.getByRole("status").filter({ hasText: "Carregando o uso de hoje…" })).toBeAttached();
    await expect(page.getByRole("status").filter({ hasText: "Carregando os envios bloqueados…" })).toBeAttached();
    await shot(page, "carregando");
    await expect(usagePanel(page).getByRole("alert")).toContainText("Não foi possível carregar.");
    await expect(blockedPanel(page).getByRole("alert")).toContainText("Não foi possível carregar.");
    await expectNoHorizontalScroll(page);
    await shot(page, "erro");
    await page.unroute(USAGE_API);
    await page.unroute(BLOCKED_API);
    await usagePanel(page).getByRole("button", { name: "Tentar de novo" }).click();
    await blockedPanel(page).getByRole("button", { name: "Tentar de novo" }).click();
  });

  await test.step("vazio: sem conexão, uso zero, aquecimento por começar e nenhum bloqueio", async () => {
    await expect(usagePanel(page).getByTestId("uso-hoje")).toHaveText(/^0\s*de 20/);
    await expect(usagePanel(page).getByRole("progressbar", { name: "Uso do limite de hoje" })).toHaveAttribute("aria-valuetext", "0 de 20");
    await expect(usagePanel(page).getByTestId("aquecimento")).toContainText("Começa quando o WhatsApp for conectado");
    await expect(usagePanel(page).getByTestId("aquecimento")).toContainText("de 20 até 200 mensagens por dia");
    await expect(blockedPanel(page).getByRole("heading", { name: "Nenhum envio bloqueado" })).toBeVisible();
    await expect(rows(blockedPanel(page))).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "vazio");
  });

  await test.step("com dados: conectado no dia 4 do aquecimento, 7 de 40 e três bloqueios com motivo", async () => {
    await page.getByRole("button", { name: "Conectar WhatsApp" }).click();
    await expect(page.getByRole("heading", { name: "Leia o código com o celular do negócio" })).toBeVisible();
    const [{ session_id: sessionId }] = await sql<{ session_id: string }>("SELECT session_id FROM whatsapp_connections WHERE tenant_id = $1", [tenantId]);
    await providerSays(provider, sessionId, "connected");
    await setCounter(tenantId, 3, 7);
    await seedBlocked(tenantId, [
      { name: "Marina Couto", phone: "+5511987650001", reason: "opt_out", type: "appointment_confirmation", channel: "whatsapp", minutesAgo: 5 },
      { name: "Rafael Nogueira", phone: "+5521998760002", reason: "not_eligible", type: "appointment_confirmation", channel: "whatsapp", minutesAgo: 30 },
      { name: "Beatriz Lima", phone: "+5531997650003", reason: "no_channel", type: "appointment_confirmation", channel: null, minutesAgo: 90 },
    ]);

    await page.reload();
    await expect(page.locator("[data-status='connected']")).toHaveText("Conectado");
    const usage = usagePanel(page);
    await expect(usage.getByTestId("uso-hoje")).toHaveText(/^7\s*de 40/);
    await expect(usage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "7");
    await expect(usage.getByTestId("aquecimento")).toContainText("Dia 4 de 14");
    await expect(usage.getByTestId("aquecimento")).toContainText("Hoje o número pode enviar até 40 mensagens. A partir do dia 5, até 80.");

    const list = rows(blockedPanel(page));
    await expect(list).toHaveCount(3);
    await expect(list.nth(0)).toContainText("Marina Couto");
    await expect(list.nth(0)).toContainText("O cliente pediu para não receber mensagens.");
    await expect(list.nth(0)).toContainText("Confirmação de agendamento");
    await expect(list.nth(0)).toContainText("WhatsApp");
    await expect(list.nth(1)).toContainText("Rafael Nogueira");
    await expect(list.nth(1)).toContainText("não escreveu nos últimos 30 dias");
    await expect(list.nth(2)).toContainText("Beatriz Lima");
    await expect(list.nth(2)).toContainText("o cliente não tem e-mail cadastrado");
    // Código cru nunca aparece; o outro tenant também não.
    await expect(blockedPanel(page)).not.toContainText(/opt_out|not_eligible|no_channel/);
    await expect(page.getByText("Cliente de Outro Tenant")).toHaveCount(0);
    await expect(blockedPanel(page).getByRole("button", { name: "Ver mais" })).toHaveCount(0);
    // Só leitura: nenhum botão nem campo no bloco.
    await expect(usage.getByRole("button")).toHaveCount(0);
    await expect(blockedPanel(page).getByRole("textbox")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "com-dados");
  });

  await test.step("número aquecido: 42 de 200 e, depois, limite do dia atingido", async () => {
    await setCounter(tenantId, 40, 42);
    await page.reload();
    const usage = usagePanel(page);
    await expect(usage.getByTestId("uso-hoje")).toHaveText(/^42\s*de 200/);
    await expect(usage.getByTestId("aquecimento")).toContainText("Concluído. O número já pode enviar até 200 mensagens por dia.");
    await expect(usage).toContainText("O contador volta a zero à meia-noite");
    await expectNoHorizontalScroll(page);
    await shot(page, "aquecido");

    await setCounter(tenantId, 40, 200);
    await page.reload();
    await expect(usage.getByTestId("uso-hoje")).toHaveText(/^200\s*de 200/);
    await expect(usage).toContainText("O limite de hoje foi atingido. As próximas mensagens saem amanhã");
    await shot(page, "limite-atingido");
  });

  await test.step("paginação: 53 bloqueios, 50 na primeira página e 'Ver mais' traz o resto", async () => {
    await seedBlocked(
      tenantId,
      Array.from({ length: 50 }, (_, index) => ({
        name: `Cliente antigo ${String(index + 1).padStart(2, "0")}`,
        phone: `+55119876${String(index + 100).padStart(5, "0")}`,
        reason: "template_inactive",
        type: "optout_confirmation" as const,
        channel: "email" as const,
        minutesAgo: 600 + index,
      })),
    );
    await page.reload();
    const panel = blockedPanel(page);
    await expect(rows(panel)).toHaveCount(50);
    await expect(rows(panel).nth(0)).toContainText("Marina Couto");
    await panel.getByRole("button", { name: "Ver mais" }).click();
    await expect(rows(panel)).toHaveCount(53);
    await expect(rows(panel).nth(52)).toContainText("Cliente antigo 50");
    await expect(rows(panel).nth(52)).toContainText("O texto deste tipo de mensagem está desligado.");
    await expect(rows(panel).nth(52)).toContainText("Confirmação de saída");
    await expect(rows(panel).nth(52)).toContainText("E-mail");
    await expect(panel.getByRole("button", { name: "Ver mais" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  expect(consoleErrors).toEqual([]);
  await provider.dispose();
  await other.dispose();
});
