import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fase 6, guia 7c no navegador: serviços, profissionais (com vínculo N:N) e horários. Criar,
// editar, arquivar/restaurar, apagar horário, estados vazio/carregando/erro e toasts (Sonner).
// Um fluxo por viewport (desktop e mobile), com prints.

const EVIDENCE_DIR = "docs/features/base-auth-tenant-servicos/evidencias";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase6-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function row(page: Page, name: string): Locator {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
}

function toastWith(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

// Espera os toasts saírem (o Sonner tira cada um em cerca de 4 s). O Sonner pausa o tempo
// enquanto o ponteiro está sobre a lista (topo, ao centro), então o ponteiro vai para o canto
// inferior esquerdo antes de esperar.
async function waitToastsGone(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.mouse.move(1, viewport.height - 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
}

test("serviços, profissionais e horários: criar, editar, vincular, arquivar e estados", async ({ page }) => {
  test.setTimeout(420_000);
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });

  // Conta nova pela API (o cookie fica no contexto do navegador). Cadastro pela tela já é da Fase 5.
  const register = await page.request.post("/api/auth/register", {
    data: { businessName: `Salão E2E ${test.info().project.name}`, email: e2eEmail(), password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);

  // ---------------------------------------------------------------- Serviços
  await test.step("serviços: estado vazio", async () => {
    await page.goto("/painel/servicos");
    await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
    // Primeira leitura pode esperar o compute da branch test do Neon acordar.
    await expect(page.getByRole("heading", { name: "Nenhum serviço ainda" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Serviços", exact: true }).first()).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalScroll(page);
    await shot(page, "01-servicos-vazio");
  });

  await test.step("serviços: estado carregando", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/services?includeArchived=true", async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Carregando serviços…" })).toBeAttached();
    await shot(page, "02-servicos-carregando");
    release();
    await expect(page.getByRole("heading", { name: "Nenhum serviço ainda" })).toBeVisible();
    await page.unroute("**/api/services?includeArchived=true");
  });

  await test.step("serviços: estado de erro e Tentar de novo", async () => {
    await page.route("**/api/services?includeArchived=true", (route) => route.abort("internetdisconnected"));
    await page.reload();
    const alert = page.getByRole("alert").filter({ hasText: "Não foi possível carregar." });
    await expect(alert).toContainText("Verifique a internet");
    await expectNoHorizontalScroll(page);
    await shot(page, "03-servicos-erro");
    await page.unroute("**/api/services?includeArchived=true");
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByRole("heading", { name: "Nenhum serviço ainda" })).toBeVisible();
  });

  await test.step("serviços: erros de campo antes de enviar", async () => {
    await page.getByRole("button", { name: "Novo serviço" }).click();
    const form = page.getByRole("form", { name: "Novo serviço" });
    await expect(form.getByLabel("Nome do serviço")).toBeFocused();
    await form.getByRole("button", { name: "Adicionar serviço" }).click();
    await expect(form.getByText("O nome do serviço precisa ter pelo menos 2 caracteres.")).toBeVisible();
    await expect(form.getByText("Informe a duração em minutos.")).toBeVisible();
    await expect(form.getByText("Informe o preço em reais, por exemplo 50,00.")).toBeVisible();
    await expect(form.getByLabel("Nome do serviço")).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByLabel("Nome do serviço")).toBeFocused();
    await shot(page, "04-servicos-form-erros");

    await form.getByLabel("Nome do serviço").fill("Corte feminino");
    await form.getByLabel("Duração (minutos)").fill("7");
    await form.getByLabel("Preço (R$)").fill("80,00");
    await form.getByRole("button", { name: "Adicionar serviço" }).click();
    await expect(form.getByText("A duração deve ser múltipla de 5 minutos.")).toBeVisible();
    await expect(form.getByLabel("Duração (minutos)")).toBeFocused();
  });

  await test.step("serviços: cria três", async () => {
    const form = page.getByRole("form", { name: "Novo serviço" });
    await form.getByLabel("Duração (minutos)").fill("45");
    await form.getByRole("button", { name: "Adicionar serviço" }).click();
    await expect(toastWith(page, "Corte feminino foi adicionado.")).toBeVisible();
    await expect(row(page, "Corte feminino")).toContainText("45 min");
    await expect(row(page, "Corte feminino")).toContainText("R$ 80,00");

    for (const [name, duration, price] of [
      ["Escova", "30", "50"],
      ["Hidratação", "60", "120,5"],
    ] as const) {
      await page.getByRole("button", { name: "Novo serviço" }).click();
      const next = page.getByRole("form", { name: "Novo serviço" });
      await next.getByLabel("Nome do serviço").fill(name);
      await next.getByLabel("Duração (minutos)").fill(duration);
      await next.getByLabel("Preço (R$)").fill(price);
      await next.getByRole("button", { name: "Adicionar serviço" }).click();
      await expect(toastWith(page, `${name} foi adicionado.`)).toBeVisible();
    }
    await expect(row(page, "Hidratação")).toContainText("1 h");
    await expect(row(page, "Hidratação")).toContainText("R$ 120,50");
    // Ordem por nome.
    await expect(page.getByRole("list", { name: "Serviços ativos" }).getByRole("heading", { level: 3 })).toHaveText([
      "Corte feminino",
      "Escova",
      "Hidratação",
    ]);
  });

  await test.step("serviços: edita no lugar (preço em centavos inteiros)", async () => {
    await page.getByRole("button", { name: "Editar Escova" }).click();
    const form = page.getByRole("form", { name: "Editar Escova" });
    await expect(form.getByLabel("Preço (R$)")).toHaveValue("50,00");
    await form.getByLabel("Preço (R$)").fill("55,90");
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toastWith(page, "Alterações salvas.")).toBeVisible();
    await expect(row(page, "Escova")).toContainText("R$ 55,90");

    const api = await page.request.get("/api/services");
    const { services } = (await api.json()) as { services: { name: string; priceCents: number; durationMinutes: number }[] };
    expect(services.find((service) => service.name === "Escova")).toMatchObject({ priceCents: 5590, durationMinutes: 30 });
    expect(services.find((service) => service.name === "Hidratação")).toMatchObject({ priceCents: 12050 });
    await waitToastsGone(page);
    await expectNoHorizontalScroll(page);
    await shot(page, "05-servicos-lista");
  });

  await test.step("serviços: arquiva, desfaz, arquiva e restaura pela lista de arquivados", async () => {
    await page.getByRole("button", { name: "Arquivar Hidratação" }).click();
    await expect(row(page, "Hidratação")).toHaveCount(0);
    await toastWith(page, "Hidratação foi arquivado.").getByRole("button", { name: "Desfazer" }).click();
    await expect(row(page, "Hidratação")).toBeVisible();
    await expect(toastWith(page, "Hidratação voltou para a lista.")).toBeVisible();

    await page.getByRole("button", { name: "Arquivar Hidratação" }).click();
    await expect(row(page, "Hidratação")).toHaveCount(0);
    await page.getByRole("button", { name: "Ver arquivados (1)" }).click();
    await expect(page.getByRole("button", { name: "Restaurar Hidratação" })).toBeVisible();
    await waitToastsGone(page);
    await shot(page, "06-servicos-arquivados");
    await page.getByRole("button", { name: "Restaurar Hidratação" }).click();
    await expect(page.getByRole("button", { name: "Arquivar Hidratação" })).toBeVisible();
    // Deixa arquivado para conferir que não aparece nos chips dos profissionais.
    await page.getByRole("button", { name: "Arquivar Hidratação" }).click();
    await expect(page.getByRole("button", { name: "Restaurar Hidratação" })).toBeVisible();
  });

  // ---------------------------------------------------------------- Profissionais
  await test.step("profissionais: estado vazio", async () => {
    await page.getByRole("link", { name: "Profissionais", exact: true }).first().click();
    await expect(page).toHaveURL(/\/painel\/profissionais$/);
    await expect(page.getByRole("heading", { name: "Nenhum profissional ainda" })).toBeVisible();
    await waitToastsGone(page);
    await expectNoHorizontalScroll(page);
    await shot(page, "07-profissionais-vazio");
  });

  await test.step("profissionais: cria com serviços (chips), só serviços ativos aparecem", async () => {
    await page.getByRole("button", { name: "Novo profissional" }).click();
    const form = page.getByRole("form", { name: "Novo profissional" });
    await form.getByRole("button", { name: "Adicionar profissional" }).click();
    await expect(form.getByText("O nome do profissional precisa ter pelo menos 2 caracteres.")).toBeVisible();

    await form.getByLabel("Nome do profissional").fill("Ana Souza");
    const chips = form.getByRole("checkbox");
    await expect(chips).toHaveCount(2);
    await expect(form.getByRole("checkbox", { name: "Hidratação" })).toHaveCount(0);
    await form.getByRole("checkbox", { name: "Corte feminino" }).check();
    await form.getByRole("checkbox", { name: "Escova" }).check();
    await expect(form.getByText("2 escolhidos.")).toBeVisible();

    // Chip marcado: violeta com texto em papel (DESIGN.md > Chips). toHaveCSS espera a transição;
    // o ponteiro sai de cima para não pegar o hover (violet-deep).
    await page.mouse.move(1, page.viewportSize()!.height - 1);
    const pill = form.getByRole("checkbox", { name: "Escova" }).locator("xpath=following-sibling::span[1]");
    await expect(pill).toHaveCSS("background-color", "rgb(73, 45, 235)");
    await expect(pill).toHaveCSS("color", "rgb(242, 242, 242)");
    await expect(pill).toHaveCSS("border-radius", "999px");
    await expect(pill).toHaveCSS("min-height", "40px");
    await shot(page, "08-profissionais-form");

    await form.getByRole("button", { name: "Adicionar profissional" }).click();
    await expect(toastWith(page, "Ana Souza entrou na equipe.")).toBeVisible();
    await expect(row(page, "Ana Souza")).toContainText("Corte feminino, Escova");
  });

  await test.step("profissionais: cria sem serviço e depois edita nome e vínculo", async () => {
    await page.getByRole("button", { name: "Novo profissional" }).click();
    let form = page.getByRole("form", { name: "Novo profissional" });
    await form.getByLabel("Nome do profissional").fill("Bruno Lima");
    await form.getByRole("button", { name: "Adicionar profissional" }).click();
    await expect(row(page, "Bruno Lima")).toContainText("Nenhum serviço escolhido");

    await page.getByRole("button", { name: "Editar Bruno Lima" }).click();
    form = page.getByRole("form", { name: "Editar Bruno Lima" });
    await expect(form.getByRole("checkbox", { name: "Escova" })).not.toBeChecked();
    await form.getByLabel("Nome do profissional").fill("Bruno Lima Costa");
    await form.getByRole("checkbox", { name: "Escova" }).check();
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toastWith(page, "Alterações salvas.")).toBeVisible();
    await expect(row(page, "Bruno Lima Costa")).toContainText("Escova");

    // Vínculo N:N gravado: Escova atende os dois.
    const list = (await (await page.request.get("/api/professionals")).json()) as { professionals: { id: string; name: string }[] };
    for (const professional of list.professionals) {
      const linked = (await (await page.request.get(`/api/professionals/${professional.id}/services`)).json()) as {
        services: { name: string }[];
      };
      expect(linked.services.map((service) => service.name)).toContain("Escova");
    }
    await waitToastsGone(page);
    await expectNoHorizontalScroll(page);
    await shot(page, "09-profissionais-lista");
  });

  await test.step("profissionais: arquiva e restaura com os serviços de volta", async () => {
    await page.getByRole("button", { name: "Arquivar Bruno Lima Costa" }).click();
    await expect(toastWith(page, "Bruno Lima Costa foi arquivado.")).toBeVisible();
    await page.getByRole("button", { name: "Ver arquivados (1)" }).click();
    await expect(row(page, "Bruno Lima Costa")).toContainText("Arquivado");
    await page.getByRole("button", { name: "Restaurar Bruno Lima Costa" }).click();
    await expect(toastWith(page, "Bruno Lima Costa voltou para a equipe.")).toBeVisible();
    await expect(row(page, "Bruno Lima Costa")).toContainText("Escova");
  });

  // ---------------------------------------------------------------- Horários
  await test.step("horários: abre pela linha do profissional, grade vazia", async () => {
    await page.getByRole("link", { name: "Horários de Ana Souza" }).click();
    await expect(page).toHaveURL(/\/painel\/profissionais\/[0-9a-f-]{36}\/horarios$/);
    await expect(page.getByRole("heading", { level: 1, name: "Horários de Ana Souza" })).toBeVisible();
    await expect(page.getByText("Nenhum dia com atendimento ainda.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Semana" }).getByRole("heading", { level: 2 })).toHaveText([
      "Segunda",
      "Terça",
      "Quarta",
      "Quinta",
      "Sexta",
      "Sábado",
      "Domingo",
    ]);
    await expect(page.getByRole("link", { name: "Profissionais", exact: true }).first()).toHaveAttribute("aria-current", "page");
    await waitToastsGone(page);
    await expectNoHorizontalScroll(page);
    await shot(page, "10-horarios-vazio");
  });

  await test.step("horários: dois intervalos na segunda", async () => {
    await page.getByRole("button", { name: "Adicionar intervalo na segunda" }).click();
    let form = page.getByRole("form", { name: "Novo intervalo de Segunda" });
    await expect(form.getByLabel("Início")).toHaveValue("09:00");
    await expect(form.getByLabel("Fim")).toHaveValue("18:00");
    await form.getByLabel("Fim").fill("12:00");
    await form.getByRole("button", { name: "Adicionar" }).click();
    await expect(toastWith(page, "Segunda, 09:00 às 12:00 adicionado.")).toBeVisible();

    await page.getByRole("button", { name: "Adicionar intervalo na segunda" }).click();
    form = page.getByRole("form", { name: "Novo intervalo de Segunda" });
    await expect(form.getByLabel("Início")).toHaveValue("12:00");
    await form.getByLabel("Início").fill("13:00");
    await form.getByLabel("Fim").fill("18:00");
    await form.getByRole("button", { name: "Adicionar" }).click();
    await expect(toastWith(page, "Segunda, 13:00 às 18:00 adicionado.")).toBeVisible();
  });

  await test.step("horários: sobreposição (409) e fim antes do início", async () => {
    await page.getByRole("button", { name: "Adicionar intervalo na segunda" }).click();
    const form = page.getByRole("form", { name: "Novo intervalo de Segunda" });
    await form.getByLabel("Início").fill("11:00");
    await form.getByLabel("Fim").fill("14:00");
    await form.getByRole("button", { name: "Adicionar" }).click();
    await expect(form.getByRole("alert")).toHaveText("Esse horário se sobrepõe a outro no mesmo dia.");
    await waitToastsGone(page);
    await shot(page, "11-horarios-sobreposicao");

    await form.getByLabel("Início").fill("15:00");
    await form.getByLabel("Fim").fill("10:00");
    await form.getByRole("button", { name: "Adicionar" }).click();
    await expect(form.getByText("O fim deve ser depois do início")).toBeVisible();
    await expect(form.getByLabel("Fim")).toBeFocused();
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toHaveCount(0);
  });

  await test.step("horários: edita um intervalo e cria outro no sábado", async () => {
    await page.getByRole("button", { name: "Editar Segunda, 13:00 às 18:00" }).click();
    const edit = page.getByRole("form", { name: "Editar intervalo de Segunda" });
    await edit.getByLabel("Início").fill("14:00");
    await edit.getByLabel("Fim").fill("19:00");
    await edit.getByRole("button", { name: "Salvar horário" }).click();
    await expect(toastWith(page, "Horário salvo.")).toBeVisible();
    await expect(page.getByText("14:00 às 19:00")).toBeVisible();

    await page.getByRole("button", { name: "Adicionar intervalo no sábado" }).click();
    const add = page.getByRole("form", { name: "Novo intervalo de Sábado" });
    await add.getByLabel("Início").fill("08:00");
    await add.getByLabel("Fim").fill("12:00");
    await add.getByRole("button", { name: "Adicionar" }).click();
    await expect(toastWith(page, "Sábado, 08:00 às 12:00 adicionado.")).toBeVisible();
    await expect(page.getByText("Atende em 2 dias da semana.")).toBeVisible();
    await waitToastsGone(page);
    await expectNoHorizontalScroll(page);
    await shot(page, "12-horarios-grade");
  });

  await test.step("horários: remove (apaga de verdade), desfaz e remove de novo", async () => {
    await page.getByRole("button", { name: "Remover Sábado, 08:00 às 12:00" }).click();
    await expect(page.getByText("Atende em 1 dia da semana.")).toBeVisible();
    await toastWith(page, "Sábado, 08:00 às 12:00 removido.").getByRole("button", { name: "Desfazer" }).click();
    await expect(page.getByRole("button", { name: "Remover Sábado, 08:00 às 12:00" })).toBeVisible();
    await page.getByRole("button", { name: "Remover Sábado, 08:00 às 12:00" }).click();
    await expect(page.getByText("Atende em 1 dia da semana.")).toBeVisible();

    // A grade gravada bate com a tela (o recarregamento mostra o mesmo).
    await page.reload();
    await expect(page.getByText("09:00 às 12:00")).toBeVisible();
    await expect(page.getByText("14:00 às 19:00")).toBeVisible();
    await expect(page.getByText("08:00 às 12:00")).toHaveCount(0);
  });

  await test.step("horários: profissional inexistente", async () => {
    await page.goto(`/painel/profissionais/${randomUUID()}/horarios`);
    await expect(page.getByRole("heading", { level: 1, name: "Profissional não encontrado" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "13-horarios-nao-encontrado");
  });

  await test.step("tokens da Algoritmi nas telas", async () => {
    await page.goto("/painel/servicos");
    await page.getByRole("button", { name: "Editar Escova" }).click();
    const styles = await page.evaluate(() => {
      const css = (element: Element | null) => getComputedStyle(element!);
      const h1 = css(document.querySelector("h1"));
      const h3 = css(document.querySelector("h3"));
      const form = document.querySelector("form[aria-label='Editar Escova']");
      const panel = css(form!.parentElement);
      const input = css(form!.querySelector("input"));
      const primary = css(form!.querySelector("button[type=submit]"));
      return {
        h1: [h1.fontFamily.toLowerCase().includes("poppins"), h1.fontWeight, h1.color],
        h3: [h3.fontFamily.toLowerCase().includes("poppins"), h3.fontWeight],
        panel: [panel.backgroundColor, panel.borderRadius],
        input: [input.height, input.borderRadius, input.fontSize],
        primary: [primary.backgroundColor, primary.height, primary.borderRadius, primary.fontWeight],
      };
    });
    expect(styles.h1).toEqual([true, "600", "rgb(38, 34, 35)"]);
    expect(styles.h3).toEqual([true, "600"]);
    expect(styles.panel).toEqual(["rgb(255, 255, 255)", "16px"]);
    expect(styles.input).toEqual(["50px", "10px", "16px"]);
    expect(styles.primary).toEqual(["rgb(73, 45, 235)", "52px", "10px", "600"]);
    await shot(page, "14-servicos-editando");
  });

  expect(consoleErrors).toEqual([]);
  // 4xx esperados: a sobreposição provocada (409) e o profissional inexistente (404, duas leituras).
  const expected = /^(409 POST \/api\/professionals\/[^/]+\/working-hours|404 GET \/api\/professionals\/[^/]+(\/working-hours)?|404 GET \/favicon\.ico)$/;
  expect(failedResponses.filter((entry) => !expected.test(entry))).toEqual([]);
  expect(failedResponses.some((entry) => entry.startsWith("409 POST"))).toBe(true);
  test.info().annotations.push({ type: "respostas 4xx", description: [...new Set(failedResponses)].join(", ") });
});
