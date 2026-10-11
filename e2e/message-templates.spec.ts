import { expect as baseExpect, test, type Locator, type Page, type Route } from "@playwright/test";
import { Client } from "pg";
import { DEFAULT_TEMPLATES } from "../src/server/outbound/templates";
import { e2eEmail } from "./accounts";

// Fatia 4 (fila-envio-limites-elegibilidade), Fase 11, guia 3 (D5, D16) no navegador: textos das
// mensagens automáticas em /painel/mensagens. Editar as variações com variáveis, ver a
// pré-visualização em texto puro, recusar variável inválida e restaurar o padrão (com "Desfazer").
// Um fluxo por viewport, com prints; o banco é a branch test do Neon.

// A branch test do Neon anda lenta (Fase 9, pendência 2): mais folga para cada leitura da tela.
const expect = baseExpect.configure({ timeout: 30_000 });

const EVIDENCE_DIR = "docs/features/fila-envio-limites-elegibilidade/evidencias";
const TEMPLATES_API = (url: URL) => url.pathname === "/api/message-templates";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase11-${project}-${name}.png`, fullPage: true });
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

async function variationsIn(tenantId: string, type: string): Promise<string[]> {
  const rows = await sql<{ variations: string[] }>(
    "SELECT variations FROM message_templates WHERE tenant_id = $1 AND message_type = $2",
    [tenantId, type],
  );
  expect(rows).toHaveLength(1);
  return rows[0].variations;
}

const list = (page: Page) => page.getByRole("list", { name: "Mensagens automáticas" });
const row = (page: Page, type: string) => page.getByTestId(`template-${type}`);
const editor = (page: Page, name: string) => page.getByRole("form", { name: `Editar ${name}` });
const preview = (scope: Locator) => scope.getByTestId("previa-texto");

test("mensagens: editar variações, recusar variável inválida e restaurar o padrão", async ({ page, playwright, baseURL }) => {
  test.setTimeout(900_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const email = e2eEmail();
  const register = await page.request.post("/api/auth/register", {
    data: { businessName: `Estúdio Textos ${test.info().project.name}`, email, password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);
  const tenantId = await tenantIdOf(email);

  // Outro tenant: as edições do primeiro nunca mexem nos textos dele.
  const other = await playwright.request.newContext({ baseURL });
  const otherEmail = e2eEmail();
  expect((await other.post("/api/auth/register", { data: { businessName: "Outro estúdio", email: otherEmail, password: "senha-forte-123" } })).status()).toBe(201);
  expect((await other.get("/api/message-templates")).status()).toBe(200);
  const otherTenantId = await tenantIdOf(otherEmail);

  await test.step("menu: item Mensagens leva à tela e fica marcado", async () => {
    await page.goto("/painel");
    await page.getByRole("navigation", { name: "Painel" }).locator("visible=true").getByRole("link", { name: "Mensagens", exact: true }).click();
    await expect(page).toHaveURL(/\/painel\/mensagens$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mensagens automáticas" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Painel" }).locator("visible=true").getByRole("link", { name: "Mensagens", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  if (test.info().project.name === "desktop") {
    await test.step("cabeçalho: menu de 8 itens numa linha só a partir de 1320px, sem encostar na conta", async () => {
      const size = page.viewportSize()!;
      const header = page.locator("header").first();
      // Barra de linha única (desktop) e segunda linha (abaixo do breakpoint), como em layout.tsx.
      const single = header.locator("nav[aria-label='Painel'].hidden");
      const second = header.locator("nav[aria-label='Painel'].pb-2");
      // A 1320px: linha única; o último link termina antes do nome da conta começar.
      await page.setViewportSize({ width: 1320, height: 900 });
      await expect(single).toBeVisible();
      await expect(second).toBeHidden();
      const lastLink = await single.getByRole("link", { name: "Configurações", exact: true }).boundingBox();
      const account = await header.getByText(email, { exact: true }).boundingBox();
      expect(lastLink!.x + lastLink!.width).toBeLessThan(account!.x);
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/fase11-desktop-menu-1320.png` });
      // A 1319px: os links descem para a segunda linha do cabeçalho.
      await page.setViewportSize({ width: 1319, height: 900 });
      await expect(single).toBeHidden();
      await expect(second).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/fase11-desktop-menu-1319.png` });
      await page.setViewportSize(size);
    });
  }

  await test.step("carregando e erro, depois 'Tentar de novo'", async () => {
    await page.route(TEMPLATES_API, async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "Algo deu errado do nosso lado. Tente de novo em instantes." } }),
      });
    });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Carregando as mensagens…" })).toBeAttached();
    await shot(page, "carregando");
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar." })).toBeVisible();
    await shot(page, "erro");
    await page.unroute(TEMPLATES_API);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(list(page).getByRole("listitem")).toHaveCount(2);
  });

  await test.step("vazio (API sem nenhum tipo)", async () => {
    await page.route(TEMPLATES_API, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ templates: [] }) }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Nenhuma mensagem automática" })).toBeVisible();
    await shot(page, "vazio");
    await page.unroute(TEMPLATES_API);
  });

  await test.step("lista por tipo com os textos padrão", async () => {
    await page.reload();
    await expect(list(page).getByRole("listitem")).toHaveCount(2);
    const confirmation = row(page, "appointment_confirmation");
    await expect(confirmation.getByRole("heading", { name: "Confirmação de agendamento" })).toBeVisible();
    await expect(confirmation).toContainText("Texto padrão");
    await expect(confirmation).toContainText("3 variações");
    await expect(row(page, "optout_confirmation").getByRole("heading", { name: "Confirmação de saída" })).toBeVisible();
    // Texto padrão não tem o que restaurar.
    await expect(page.getByRole("button", { name: /Restaurar o texto padrão/ })).toHaveCount(0);
    // Sem criar nem excluir tipo de mensagem (fora do escopo, D16).
    await expect(page.getByRole("button", { name: /Nova|Novo|Criar|Excluir/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "lista");
  });

  await test.step("editar: variações com variáveis, pré-visualização em texto puro e salvar", async () => {
    await page.getByRole("button", { name: "Editar Confirmação de agendamento" }).click();
    const form = editor(page, "Confirmação de agendamento");
    await expect(form).toBeVisible();
    await expect(form.getByRole("textbox")).toHaveCount(3);
    await expect(form.getByLabel("Variação 1", { exact: true })).toHaveValue(DEFAULT_TEMPLATES.appointment_confirmation[0]);
    // Pré-visualização da variação 1 com dados de exemplo.
    await expect(preview(form)).toHaveText(
      "Olá, Mariana! Seu horário de Corte e escova com Bia está confirmado para 15/10/2026 às 14:30. Até lá! Estúdio Aurora",
    );
    await shot(page, "editar");

    await form.getByLabel("Variação 1", { exact: true }).fill("Oi, {{nome}}! <b>Confirmado</b>: {{servico}} em {{data}}, ");
    // Insere a variável no cursor (fim do texto) pelo chip.
    await form.getByRole("button", { name: "Inserir Horário na variação 1" }).click();
    await expect(form.getByLabel("Variação 1", { exact: true })).toHaveValue("Oi, {{nome}}! <b>Confirmado</b>: {{servico}} em {{data}}, {{hora}}");
    // Texto puro: a marcação aparece como texto e não vira elemento.
    await expect(preview(form)).toHaveText("Oi, Mariana! <b>Confirmado</b>: Corte e escova em 15/10/2026, 14:30");
    await expect(preview(form).locator("b")).toHaveCount(0);

    // Uma quarta variação.
    await form.getByRole("button", { name: "Adicionar variação" }).click();
    await expect(form.getByRole("textbox")).toHaveCount(4);
    await form.getByLabel("Variação 4", { exact: true }).fill("{{nome}}, até {{data}} às {{hora}} com {{profissional}}.");
    await expect(form.getByRole("button", { name: "Mostrar a variação 4" })).toHaveAttribute("aria-pressed", "true");
    await expect(preview(form)).toHaveText("Mariana, até 15/10/2026 às 14:30 com Bia.");
    await expectNoHorizontalScroll(page);
    await shot(page, "editar-preenchido");

    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Alterações salvas.")).toBeVisible();
    await expect(form).toHaveCount(0);
    const confirmation = row(page, "appointment_confirmation");
    await expect(confirmation).toContainText("Personalizado");
    await expect(confirmation).toContainText("4 variações");
    expect(await variationsIn(tenantId, "appointment_confirmation")).toEqual([
      "Oi, {{nome}}! <b>Confirmado</b>: {{servico}} em {{data}}, {{hora}}",
      ...DEFAULT_TEMPLATES.appointment_confirmation.slice(1),
      "{{nome}}, até {{data}} às {{hora}} com {{profissional}}.",
    ]);
    await shot(page, "salvo");
  });

  await test.step("variável inválida: recusada antes de salvar e nada muda no banco", async () => {
    await page.getByRole("button", { name: "Editar Confirmação de saída" }).click();
    const form = editor(page, "Confirmação de saída");
    // Confirmação de saída só aceita nome e negócio (D16).
    await expect(form.getByRole("button", { name: /^Inserir / })).toHaveCount(2);
    const second = form.getByLabel("Variação 2", { exact: true });
    await second.fill("Ok, {{nome}}. Seu {{servico}} foi cancelado.");
    await expect(preview(form)).toHaveText("Ok, Mariana. Seu {{servico}} foi cancelado.");
    await form.getByLabel("Variação 3", { exact: true }).fill("");

    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") patches.push(request.url());
    });
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(form.getByText("A variação 2 usa a variável {{servico}}, que não existe para esta mensagem.")).toBeVisible();
    await expect(form.getByText("A variação 3 está vazia.")).toBeVisible();
    await expect(second).toHaveAttribute("aria-invalid", "true");
    await expect(second).toBeFocused();
    await expect(form).toBeVisible();
    expect(patches).toEqual([]);
    await expectNoHorizontalScroll(page);
    await shot(page, "variavel-invalida");

    // O servidor recusa do mesmo jeito (a tela mostra o problema na variação certa).
    await second.fill("Ok, {{nome}}. {{negocio}} não envia mais.");
    await expect(form.getByText(/A variação 2 usa a variável/)).toHaveCount(0);
    await page.route(/\/api\/message-templates\/[^/]+$/, (route) =>
      route.request().method() === "PATCH"
        ? route.continue({ postData: JSON.stringify({ variations: ["a {{nome}}", "b {{cupom}}", "c {{negocio}}"] }) })
        : route.continue(),
    );
    await form.getByLabel("Variação 3", { exact: true }).fill("Tudo certo, {{nome}}.");
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(form.getByText("A variação 2 usa a variável {{cupom}}, que não existe para esta mensagem.")).toBeVisible();
    await page.unroute(/\/api\/message-templates\/[^/]+$/);

    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toHaveCount(0);
    expect(await variationsIn(tenantId, "optout_confirmation")).toEqual([...DEFAULT_TEMPLATES.optout_confirmation]);
    await expect(row(page, "optout_confirmation")).toContainText("Texto padrão");
  });

  await test.step("restaurar padrão, desfazer e restaurar de novo", async () => {
    const confirmation = row(page, "appointment_confirmation");
    await page.getByRole("button", { name: "Restaurar o texto padrão de Confirmação de agendamento" }).click();
    await expect(page.getByText("Confirmação de agendamento voltou ao texto padrão.")).toBeVisible();
    await expect(confirmation).toContainText("Texto padrão");
    await expect(confirmation).toContainText("3 variações");
    expect(await variationsIn(tenantId, "appointment_confirmation")).toEqual([...DEFAULT_TEMPLATES.appointment_confirmation]);
    await shot(page, "restaurado");

    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(confirmation).toContainText("Personalizado");
    await expect(confirmation).toContainText("4 variações");
    expect(await variationsIn(tenantId, "appointment_confirmation")).toHaveLength(4);

    await page.getByRole("button", { name: "Restaurar o texto padrão de Confirmação de agendamento" }).click();
    await expect(confirmation).toContainText("Texto padrão");
    expect(await variationsIn(tenantId, "appointment_confirmation")).toEqual([...DEFAULT_TEMPLATES.appointment_confirmation]);

    // Recarregar mostra o que está no banco.
    await page.reload();
    await expect(row(page, "appointment_confirmation")).toContainText("Texto padrão");
  });

  await test.step("o outro tenant não foi tocado", async () => {
    expect(await variationsIn(otherTenantId, "appointment_confirmation")).toEqual([...DEFAULT_TEMPLATES.appointment_confirmation]);
    expect(await variationsIn(otherTenantId, "optout_confirmation")).toEqual([...DEFAULT_TEMPLATES.optout_confirmation]);
  });

  expect(consoleErrors).toEqual([]);
  await other.dispose();
});
