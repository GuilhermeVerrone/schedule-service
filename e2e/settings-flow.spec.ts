import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fatia 2 (agenda-link-publico), Fase 6, guia 7e no navegador: /painel/configuracoes com dados do
// negócio e os 5 parâmetros da agenda (D2, D3). Menu, estados vazio/carregando/erro, validação,
// salvar, recarregar e o efeito dos parâmetros nos horários. Um fluxo por viewport, com prints.

const EVIDENCE_DIR = "docs/features/agenda-link-publico/evidencias";
const SETTINGS_API = "**/api/settings";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  // Topo da página: com a página rolada, o cabeçalho fixo sairia no meio do print de página inteira.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase6-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function toastWith(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function waitToastsGone(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.mouse.move(1, viewport.height - 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
}

// Dia AAAA-MM-DD no fuso de São Paulo, daqui a `days` dias.
function dayInSaoPaulo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + days * 86_400_000));
}

test("configurações: dados do negócio e regras da agenda", async ({ page }) => {
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });

  const project = test.info().project.name;
  const businessName = `Estúdio E2E ${project}`;
  const register = await page.request.post("/api/auth/register", {
    data: { businessName, email: e2eEmail(), password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);

  // Catálogo mínimo pela API (as telas do catálogo são da Fatia 1) para medir os horários:
  // serviço de 30 min, profissional vinculado, 09:00 às 12:00 todos os dias.
  const service = await page.request.post("/api/services", { data: { name: "Corte", durationMinutes: 30, priceCents: 5000 } });
  expect(service.status()).toBe(201);
  const serviceId = (await service.json()).service.id as string;
  const professional = await page.request.post("/api/professionals", { data: { name: "Ana" } });
  expect(professional.status()).toBe(201);
  const professionalId = (await professional.json()).professional.id as string;
  expect((await page.request.put(`/api/professionals/${professionalId}/services`, { data: { serviceIds: [serviceId] } })).status()).toBe(200);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const hours = await page.request.post(`/api/professionals/${professionalId}/working-hours`, {
      data: { weekday, start: "09:00", end: "12:00" },
    });
    expect(hours.status()).toBe(201);
  }
  const slotsOn = async (date: string) => {
    const response = await page.request.get(`/api/availability?serviceId=${serviceId}&professionalId=${professionalId}&date=${date}`);
    expect(response.status()).toBe(200);
    return ((await response.json()).slots as unknown[]).length;
  };
  const in7Days = dayInSaoPaulo(7);
  const in75Days = dayInSaoPaulo(75);
  // Padrões (D3): passo 15 min → 09:00 a 11:30 = 11 horários; D+75 fora da janela de 60 dias.
  expect(await slotsOn(in7Days)).toBe(11);
  expect(await slotsOn(in75Days)).toBe(0);

  const business = page.getByRole("form", { name: "Dados do negócio" });
  const agenda = page.getByRole("form", { name: "Regras da agenda" });

  await test.step("menu leva às configurações; estado vazio com os padrões", async () => {
    await page.goto("/painel");
    await page.getByRole("link", { name: "Configurações", exact: true }).locator("visible=true").click();
    await expect(page).toHaveURL(/\/painel\/configuracoes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Configurações", exact: true }).locator("visible=true")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Seu site ainda está sem descrição, endereço e telefone.")).toBeVisible({ timeout: 20_000 });
    // No celular o menu rola na horizontal: o item da página atual fica inteiro na área visível.
    const fullyVisible = await page.evaluate(() => {
      const link = [...document.querySelectorAll<HTMLElement>("header nav a[aria-current='page']")].find((a) => a.offsetParent !== null)!;
      const nav = link.closest("nav")!.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      // Tolerância de 1px para o arredondamento de subpixel.
      return box.left >= nav.left - 1 && box.right <= nav.right + 1;
    });
    expect(fullyVisible).toBe(true);

    // Somente leitura: nome, endereço do site pelo slug (origem atual) e fuso.
    const settings = (await (await page.request.get("/api/settings")).json()).settings;
    await expect(page.locator("main dl").getByText(businessName, { exact: true })).toBeVisible();
    await expect(page.locator("main dl").getByText(`/${settings.slug}`)).toBeVisible();
    await expect(page.locator("main dl").getByText("America/Sao Paulo")).toBeVisible();

    await expect(business.getByLabel("Descrição")).toHaveValue("");
    await expect(agenda.getByLabel("Intervalo entre horários (minutos)")).toHaveValue("15");
    await expect(agenda.getByLabel("Pausa após cada atendimento (minutos)")).toHaveValue("0");
    await expect(agenda.getByLabel("Antecedência mínima", { exact: true })).toHaveValue("2");
    await expect(agenda.getByLabel("Unidade de antecedência mínima")).toHaveValue("hours");
    await expect(agenda.getByLabel("Agenda aberta para os próximos (dias)")).toHaveValue("60");
    await expect(agenda.getByLabel("Prazo para cancelar ou remarcar", { exact: true })).toHaveValue("2");
    await expect(agenda.getByLabel("Unidade de prazo para cancelar ou remarcar")).toHaveValue("hours");
    await expectNoHorizontalScroll(page);
    await shot(page, "01-configuracoes-vazio");
  });

  await test.step("estado carregando", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(SETTINGS_API, async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Carregando configurações…" })).toBeAttached();
    await expectNoHorizontalScroll(page);
    await shot(page, "02-configuracoes-carregando");
    release();
    await expect(business).toBeVisible();
    await page.unroute(SETTINGS_API);
  });

  await test.step("estado de erro e Tentar de novo", async () => {
    await page.route(SETTINGS_API, (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar." })).toContainText("Verifique a internet");
    await expectNoHorizontalScroll(page);
    await shot(page, "03-configuracoes-erro");
    await page.unroute(SETTINGS_API);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(business).toBeVisible();
  });

  await test.step("dados do negócio: falha do servidor aparece no formulário", async () => {
    await page.route(SETTINGS_API, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, json: { error: { code: "internal", message: "Algo deu errado do nosso lado. Tente de novo em instantes." } } })
        : route.continue(),
    );
    await business.getByLabel("Telefone").fill("(13) 99999-0000");
    await business.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(business.getByRole("alert")).toContainText("Algo deu errado do nosso lado.");
    await page.unroute(SETTINGS_API);
  });

  await test.step("dados do negócio: salvar", async () => {
    await business.getByLabel("Descrição").fill("Corte, escova e coloração com hora marcada.");
    await business.getByLabel("Endereço").fill("Rua das Flores, 120, Centro, Santos");
    await business.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toastWith(page, "Dados do negócio salvos.")).toBeVisible();
    await expect(business.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Seu site ainda está sem descrição")).toHaveCount(0);
    const saved = (await (await page.request.get("/api/settings")).json()).settings;
    expect([saved.description, saved.address, saved.phone]).toEqual([
      "Corte, escova e coloração com hora marcada.",
      "Rua das Flores, 120, Centro, Santos",
      "(13) 99999-0000",
    ]);
    // Salvar o negócio não mexe nas regras da agenda.
    expect(saved.slotStepMinutes).toBe(15);
    await expectNoHorizontalScroll(page);
    await shot(page, "04-negocio-salvo");
    await waitToastsGone(page);
  });

  await test.step("regras da agenda: erros de campo antes de enviar", async () => {
    await agenda.getByLabel("Intervalo entre horários (minutos)").fill("7");
    await agenda.getByLabel("Pausa após cada atendimento (minutos)").fill("200");
    await agenda.getByLabel("Antecedência mínima", { exact: true }).fill("duas");
    await agenda.getByLabel("Agenda aberta para os próximos (dias)").fill("0");
    await agenda.getByLabel("Prazo para cancelar ou remarcar", { exact: true }).fill("31");
    await agenda.getByLabel("Unidade de prazo para cancelar ou remarcar").selectOption("days");
    await agenda.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(agenda.getByText("Use de 5 a 120 minutos, em múltiplos de 5.")).toBeVisible();
    await expect(agenda.getByText("Use de 0 a 120 minutos, em múltiplos de 5.")).toBeVisible();
    await expect(agenda.getByText("Informe um número, por exemplo 2 horas.")).toBeVisible();
    await expect(agenda.getByText("Use de 1 a 365 dias.")).toBeVisible();
    await expect(agenda.getByText("Use no máximo 30 dias.")).toBeVisible();
    await expect(agenda.getByLabel("Intervalo entre horários (minutos)")).toHaveAttribute("aria-invalid", "true");
    await expect(agenda.getByLabel("Intervalo entre horários (minutos)")).toBeFocused();
    await expectNoHorizontalScroll(page);
    await shot(page, "05-agenda-erros");

    // Nada foi gravado.
    const unchanged = (await (await page.request.get("/api/settings")).json()).settings;
    expect(unchanged.slotStepMinutes).toBe(15);
  });

  await test.step("regras da agenda: salvar e ver o efeito nos horários", async () => {
    await agenda.getByLabel("Intervalo entre horários (minutos)").fill("30");
    await agenda.getByLabel("Pausa após cada atendimento (minutos)").fill("10");
    await agenda.getByLabel("Antecedência mínima", { exact: true }).fill("1");
    await agenda.getByLabel("Unidade de antecedência mínima").selectOption("days");
    await agenda.getByLabel("Agenda aberta para os próximos (dias)").fill("90");
    await agenda.getByLabel("Prazo para cancelar ou remarcar", { exact: true }).fill("90");
    await agenda.getByLabel("Unidade de prazo para cancelar ou remarcar").selectOption("minutes");
    await agenda.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toastWith(page, "Regras da agenda salvas.")).toBeVisible();
    await expect(agenda.getByText("Use de", { exact: false })).toHaveCount(0);

    const saved = (await (await page.request.get("/api/settings")).json()).settings;
    expect([saved.slotStepMinutes, saved.bufferMinutes, saved.minAdvanceMinutes, saved.maxWindowDays, saved.cancelDeadlineMinutes]).toEqual([
      30, 10, 1440, 90, 90,
    ]);
    // Salvar a agenda não mexe nos dados do negócio.
    expect(saved.address).toBe("Rua das Flores, 120, Centro, Santos");
    // Passo 30 → 09:00 a 11:30 = 6 horários; janela de 90 dias abre o D+75.
    expect(await slotsOn(in7Days)).toBe(6);
    expect(await slotsOn(in75Days)).toBe(6);
    await expectNoHorizontalScroll(page);
    await shot(page, "06-agenda-salva");
    await waitToastsGone(page);
  });

  await test.step("recarregar mostra o que foi gravado; texto vazio limpa o campo", async () => {
    await page.reload();
    await expect(agenda.getByLabel("Intervalo entre horários (minutos)")).toHaveValue("30");
    await expect(agenda.getByLabel("Antecedência mínima", { exact: true })).toHaveValue("1");
    await expect(agenda.getByLabel("Unidade de antecedência mínima")).toHaveValue("days");
    await expect(agenda.getByLabel("Prazo para cancelar ou remarcar", { exact: true })).toHaveValue("90");
    await expect(agenda.getByLabel("Unidade de prazo para cancelar ou remarcar")).toHaveValue("minutes");
    await expect(business.getByLabel("Telefone")).toHaveValue("(13) 99999-0000");

    await business.getByLabel("Endereço").fill("");
    await business.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toastWith(page, "Dados do negócio salvos.")).toBeVisible();
    const saved = (await (await page.request.get("/api/settings")).json()).settings;
    expect(saved.address).toBeNull();
    await waitToastsGone(page);
  });

  await test.step("tokens da Algoritmi na tela", async () => {
    const styles = await page.evaluate(() => {
      const css = (element: Element | null) => getComputedStyle(element!);
      const h1 = css(document.querySelector("h1"));
      const h2 = css(document.querySelector("main h2"));
      const form = document.querySelector("form[aria-label='Regras da agenda']")!;
      const panel = css(form.parentElement);
      const input = css(form.querySelector("input"));
      const select = css(form.querySelector("select"));
      const textarea = css(document.querySelector("textarea"));
      const primary = css(form.querySelector("button[type=submit]"));
      const label = css(form.querySelector("label"));
      return {
        h1: [h1.fontFamily.toLowerCase().includes("poppins"), h1.fontWeight, h1.color],
        h2: [h2.fontFamily.toLowerCase().includes("poppins"), h2.fontWeight],
        panel: [panel.backgroundColor, panel.borderRadius],
        input: [input.height, input.borderRadius, input.fontSize, input.fontFamily.toLowerCase().includes("manrope")],
        select: [select.height, select.borderRadius, select.fontSize],
        textarea: [textarea.minHeight, textarea.borderRadius],
        primary: [primary.backgroundColor, primary.height, primary.borderRadius, primary.fontWeight],
        label: [label.fontWeight, label.fontFamily.toLowerCase().includes("manrope")],
      };
    });
    expect(styles.h1).toEqual([true, "600", "rgb(38, 34, 35)"]);
    expect(styles.h2).toEqual([true, "600"]);
    expect(styles.panel).toEqual(["rgb(255, 255, 255)", "16px"]);
    expect(styles.input).toEqual(["50px", "10px", "16px", true]);
    expect(styles.select).toEqual(["50px", "10px", "16px"]);
    expect(styles.textarea).toEqual(["120px", "10px"]);
    expect(styles.primary).toEqual(["rgb(73, 45, 235)", "52px", "10px", "600"]);
    expect(styles.label).toEqual(["600", true]);
    await expectNoHorizontalScroll(page);
    await shot(page, "07-configuracoes-preenchida");
  });

  expect(consoleErrors).toEqual([]);
  // 4xx/5xx esperados: só o 500 simulado no PATCH.
  expect(failedResponses.filter((entry) => entry !== "500 PATCH /api/settings" && entry !== "404 GET /favicon.ico")).toEqual([]);
  test.info().annotations.push({ type: "respostas 4xx/5xx", description: [...new Set(failedResponses)].join(", ") });
});
