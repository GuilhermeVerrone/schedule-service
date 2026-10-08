import { expect, test, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fase 5, guia 7a e 7b no navegador: proteção do /painel, cadastro, logout e login, com os
// estados de erro e os toasts (Sonner). Um fluxo por viewport (desktop e mobile), com prints.

const EVIDENCE_DIR = "docs/features/base-auth-tenant-servicos/evidencias";
const PASSWORD = "senha-forte-123";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase5-${project}-${name}.png`, fullPage: true });
}

// Sem rolagem horizontal em nenhum viewport (DESIGN.md: mobile primeiro).
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("cadastro, logout, login e proteção do painel", async ({ page, context }) => {
  // Erros de JS no console falham o teste. Respostas 4xx/5xx são conferidas pela URL: só valem
  // as provocadas de propósito (409 e 401) e os 404 das telas da Fase 6 (prefetch dos links do
  // painel) e do favicon, que o projeto ainda não tem.
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);

    }
  });

  const email = e2eEmail();
  const businessName = `Estúdio Ana ${test.info().project.name}`;

  await test.step("sem sessão, /painel vai para o login guardando o destino", async () => {
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/login\?next=%2Fpainel$/);
    await expect(page.getByRole("heading", { level: 1, name: "Entre no seu painel" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "01-login");
  });

  await test.step("tokens da Algoritmi aplicados (fontes, cores, alturas)", async () => {
    const styles = await page.evaluate(() => {
      const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const button = css("button[type=submit]");
      const input = css("#campo-email");
      const h1 = css("h1");
      return {
        body: [getComputedStyle(document.body).fontFamily, getComputedStyle(document.body).backgroundColor],
        h1: [h1.fontFamily, h1.fontWeight, h1.color],
        button: [button.backgroundColor, button.color, button.height, button.borderRadius, button.fontWeight],
        input: [input.backgroundColor, input.height, input.borderRadius, input.fontSize],
      };
    });
    expect(styles.body[0]).toMatch(/manrope/i);
    expect(styles.body[1]).toBe("rgb(242, 242, 242)");
    expect(styles.h1[0]).toMatch(/poppins/i);
    expect(styles.h1.slice(1)).toEqual(["600", "rgb(38, 34, 35)"]);
    expect(styles.button).toEqual(["rgb(73, 45, 235)", "rgb(242, 242, 242)", "52px", "10px", "600"]);
    expect(styles.input).toEqual(["rgb(255, 255, 255)", "50px", "10px", "16px"]);
  });

  await test.step("cadastro: erros de campo antes de enviar", async () => {
    await page.getByRole("link", { name: "Criar minha conta" }).first().click();
    await expect(page).toHaveURL(/\/cadastro$/);
    await page.getByRole("button", { name: "Criar minha conta" }).click();
    await expect(page.getByText("O nome do negócio precisa ter pelo menos 2 caracteres.")).toBeVisible();
    await expect(page.getByText("E-mail inválido.")).toBeVisible();
    await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
    await expect(page.getByLabel("Nome do negócio")).toBeFocused();
    await expect(page.getByLabel("Nome do negócio")).toHaveAttribute("aria-invalid", "true");
    await expectNoHorizontalScroll(page);
    await shot(page, "02-cadastro-erros");
  });

  await test.step("cadastro: conta criada, entra logado com toast", async () => {
    await page.getByLabel("Nome do negócio").fill(businessName);
    await page.getByLabel("E-mail").fill(email.toUpperCase());
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar senha" }).click();
    await shot(page, "03-cadastro-preenchido");
    await page.getByRole("button", { name: "Criar minha conta" }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await expect(page.getByText("Conta criada")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: `Olá, ${businessName}` })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Painel" }).getByRole("link", { name: "Início" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoHorizontalScroll(page);
    await shot(page, "04-painel-toast");
    await expect(page.getByText("Conta criada")).toBeHidden({ timeout: 10_000 });
    await shot(page, "04-painel");
  });

  await test.step("cookie de sessão host-only, HttpOnly, Secure, SameSite=Lax", async () => {
    const cookie = (await context.cookies()).find((c) => c.name === "__Host-slotz_session");
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/", domain: "localhost" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("slotz_session");
  });

  await test.step("logado, /login e /cadastro voltam para o painel", async () => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto("/cadastro");
    await expect(page).toHaveURL(/\/painel$/);
  });

  await test.step("logout: volta ao login com toast e o painel fecha", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Você saiu da conta.")).toBeVisible();
    await shot(page, "05-logout");
    expect((await context.cookies()).find((c) => c.name === "__Host-slotz_session")).toBeUndefined();
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/login\?next=%2Fpainel$/);
  });

  await test.step("cadastro com e-mail já usado: erro no campo", async () => {
    await page.goto("/cadastro");
    await page.getByLabel("Nome do negócio").fill("Outro negócio");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Criar minha conta" }).click();
    await expect(page.getByText("Este e-mail já tem conta. Entre ou use outro e-mail.")).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeFocused();
    await expect(page).toHaveURL(/\/cadastro$/);
    await shot(page, "06-cadastro-email-em-uso");
  });

  await test.step("login com senha errada: erro genérico no alerta", async () => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-1");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, "07-login-erro");
  });

  await test.step("login certo volta para o destino guardado em ?next=", async () => {
    await page.goto("/painel?origem=e2e");
    await expect(page).toHaveURL(/\/login\?next=%2Fpainel%3Forigem%3De2e$/);
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/painel\?origem=e2e$/);
    await expect(page.getByRole("heading", { level: 1, name: `Olá, ${businessName}` })).toBeVisible();
    // No desktop o cabeçalho mostra o e-mail do dono; no mobile só a saudação e o botão Sair.
    if (test.info().project.name === "desktop") await expect(page.getByText(email)).toBeVisible();
  });

  await test.step("?next= para fora do painel é ignorado", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/login?next=https%3A%2F%2Fevil.example%2F");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/localhost:3100\/painel$/);
  });

  await test.step("outra conta na mesma aba não vê o painel da anterior", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Criar minha conta" }).first().click();
    const otherName = `Barbearia Leo ${test.info().project.name}`;
    await page.getByLabel("Nome do negócio").fill(otherName);
    await page.getByLabel("E-mail").fill(e2eEmail());
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Criar minha conta" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Olá, ${otherName}` })).toBeVisible();
    await expect(page.getByText(businessName)).toHaveCount(0);
  });

  expect(consoleErrors).toEqual([]);
  const expected = /^(409 \/api\/auth\/register|401 \/api\/auth\/login|404 \/favicon\.ico|404 \/painel\/(servicos|profissionais))$/;
  expect(failedResponses.filter((entry) => !expected.test(entry))).toEqual([]);
  expect(failedResponses).toContain("409 /api/auth/register");
  expect(failedResponses).toContain("401 /api/auth/login");
  test.info().annotations.push({ type: "respostas 4xx", description: [...new Set(failedResponses)].join(", ") });
});
