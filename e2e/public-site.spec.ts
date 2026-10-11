import { expect, test, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fatia 2 (agenda-link-publico), Fase 8, guia 3, 7a e 7f no navegador: site público em /{slug}
// com menu Início, Serviços e Equipe (D1, D2). Estados vazios, catálogo filtrado (arquivados e
// sem vínculo não aparecem), metadados, 404 por slug e as rotas do app intactas. Um fluxo por
// viewport, com prints.

const EVIDENCE_DIR = "docs/features/agenda-link-publico/evidencias";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase8-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function metaDescription(page: Page): Promise<string | null> {
  return page.locator('meta[name="description"]').getAttribute("content");
}

test("site público: menu, páginas, estados vazios e 404", async ({ page }) => {
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
  const isMobile = project === "mobile";
  const businessName = `Studio Fase Oito ${project}`;
  const register = await page.request.post("/api/auth/register", {
    data: { businessName, email: e2eEmail(), password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);
  const slug = ((await (await page.request.get("/api/settings")).json()).settings.slug) as string;
  expect(slug).toMatch(/^studio-fase-oito-/);

  // O menu fica no cabeçalho no desktop e numa segunda linha no celular: só um deles aparece.
  const nav = page.getByRole("navigation", { name: "Site" }).locator("visible=true");
  const menuLink = (name: string) => nav.getByRole("link", { name, exact: true });
  // Depois de navegar pelo menu, o Next guarda a página anterior escondida no DOM: o texto
  // conferido é só o visível.
  const visibleText = (text: string) => page.getByText(text).locator("visible=true");

  await test.step("negócio sem descrição, serviços nem equipe: estados vazios", async () => {
    const response = await page.goto(`/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(nav).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: businessName })).toBeVisible();
    await expect(visibleText("Conheça os serviços e a equipe.")).toBeVisible();
    await expect(visibleText("Nenhum serviço disponível no momento.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Contato" })).toHaveCount(0);
    await expect(page).toHaveTitle(businessName);
    expect(await metaDescription(page)).toBe(`Serviços, equipe e contato de ${businessName}.`);
    await expectNoHorizontalScroll(page);
    await shot(page, "01-inicio-vazio");

    await menuLink("Serviços").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/servicos$`));
    await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
    await expect(visibleText("Nenhum serviço disponível no momento.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "02-servicos-vazio");

    await menuLink("Equipe").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/equipe$`));
    await expect(visibleText("Nenhum profissional disponível no momento.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "03-equipe-vazio");
  });

  // Catálogo pela API (as telas do catálogo são da Fatia 1): 4 serviços ativos e vinculados,
  // 1 arquivado e 1 sem profissional; Ana e Bruno ativos, Carla arquivada.
  const createService = async (name: string, durationMinutes: number, priceCents: number) => {
    const response = await page.request.post("/api/services", { data: { name, durationMinutes, priceCents } });
    expect(response.status()).toBe(201);
    return (await response.json()).service.id as string;
  };
  const createProfessional = async (name: string) => {
    const response = await page.request.post("/api/professionals", { data: { name } });
    expect(response.status()).toBe(201);
    return (await response.json()).professional.id as string;
  };
  const link = async (professionalId: string, serviceIds: string[]) => {
    expect((await page.request.put(`/api/professionals/${professionalId}/services`, { data: { serviceIds } })).status()).toBe(200);
  };

  await test.step("dados do negócio e catálogo", async () => {
    const settings = await page.request.patch("/api/settings", {
      data: {
        description: "Cortes, coloração e barba no centro de Santos.\nAtendimento com hora marcada.",
        address: "Av. Ana Costa, 100, Santos, SP",
        phone: "(13) 99999-0000",
      },
    });
    expect(settings.status()).toBe(200);
    const corte = await createService("Corte feminino", 45, 8000);
    const barba = await createService("Barba", 30, 4000);
    const coloracao = await createService("Coloração", 120, 18990);
    const escova = await createService("Escova", 40, 5500);
    const antigo = await createService("Serviço arquivado", 30, 1000);
    await createService("Serviço sem profissional", 30, 1000);
    const ana = await createProfessional("Ana Lima");
    const bruno = await createProfessional("Bruno Reis");
    const carla = await createProfessional("Carla Arquivada");
    await link(ana, [corte, coloracao, escova, antigo]);
    await link(bruno, [barba, corte]);
    await link(carla, [corte]);
    expect((await page.request.post(`/api/services/${antigo}/archive`)).status()).toBe(200);
    expect((await page.request.post(`/api/professionals/${carla}/archive`)).status()).toBe(200);
  });

  await test.step("Início com descrição, prévia dos serviços e contato", async () => {
    // Visita nova (o layout do site não recarrega entre as páginas de uma mesma visita).
    await page.goto(`/${slug}/equipe`);
    await menuLink("Início").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    await expect(menuLink("Início")).toHaveAttribute("aria-current", "page");
    await expect(visibleText("Cortes, coloração e barba no centro de Santos.")).toBeVisible();
    const preview = page.getByRole("list", { name: "Serviços" });
    await expect(preview.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Ver todos os serviços" })).toBeVisible();
    const contact = page.getByRole("region", { name: "Contato" });
    await expect(contact.getByText("Av. Ana Costa, 100, Santos, SP")).toBeVisible();
    await expect(contact.getByRole("link", { name: "(13) 99999-0000" })).toHaveAttribute("href", "tel:13999990000");
    expect(await metaDescription(page)).toBe("Cortes, coloração e barba no centro de Santos. Atendimento com hora marcada.");
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText("Av. Ana Costa, 100, Santos, SP");
    await expect(footer.getByRole("link", { name: "(13) 99999-0000" })).toHaveAttribute("href", "tel:13999990000");

    // Tokens do DESIGN.md: h1 Poppins 600 grafite, botão principal violeta de 52px e raio 10px.
    const h1 = await page.getByRole("heading", { level: 1 }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, weight: style.fontWeight, color: style.color };
    });
    expect(h1.family.toLowerCase()).toContain("poppins");
    expect(h1).toMatchObject({ weight: "600", color: "rgb(38, 34, 35)" });
    const primary = await page.getByRole("link", { name: "Ver serviços e preços" }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, height: style.height, radius: style.borderRadius, family: style.fontFamily };
    });
    expect(primary).toMatchObject({ background: "rgb(73, 45, 235)", height: "52px", radius: "10px" });
    expect(primary.family.toLowerCase()).toContain("manrope");
    // Alvos de toque do menu com 40px ou mais.
    for (const box of await nav.getByRole("link").evaluateAll((links) => links.map((a) => a.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(40);
    }
    await expectNoHorizontalScroll(page);
    await shot(page, "04-inicio");
  });

  await test.step("Serviços pelo menu: só ativos e vinculados, com duração, preço e quem atende", async () => {
    await menuLink("Serviços").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/servicos$`));
    await expect(menuLink("Serviços")).toHaveAttribute("aria-current", "page");
    await expect(menuLink("Início")).not.toHaveAttribute("aria-current", "page");
    const items = page.getByRole("list", { name: "Serviços" }).getByRole("listitem");
    await expect(items).toHaveCount(4);
    await expect(items.getByRole("heading", { level: 3 })).toHaveText(["Barba", "Coloração", "Corte feminino", "Escova"]);
    const corte = items.filter({ hasText: "Corte feminino" });
    await expect(corte).toContainText("Com Ana Lima e Bruno Reis");
    await expect(corte).toContainText("45 min");
    await expect(corte).toContainText("R$ 80,00");
    await expect(items.filter({ hasText: "Coloração" })).toContainText("2 h");
    await expect(items.filter({ hasText: "Coloração" })).toContainText("R$ 189,90");
    await expect(page.getByText("Serviço arquivado")).toHaveCount(0);
    await expect(page.getByText("Serviço sem profissional")).toHaveCount(0);
    await expect(page.getByText("Carla Arquivada")).toHaveCount(0);
    await expect(page).toHaveTitle(`Serviços · ${businessName}`);
    expect(await metaDescription(page)).toBe(`Serviços, duração e preços de ${businessName}.`);
    await expectNoHorizontalScroll(page);
    await shot(page, "05-servicos");
  });

  await test.step("Equipe pelo menu: só profissionais ativos, com os serviços de cada um", async () => {
    await menuLink("Equipe").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/equipe$`));
    await expect(menuLink("Equipe")).toHaveAttribute("aria-current", "page");
    const items = page.getByRole("list", { name: "Equipe" }).getByRole("listitem");
    await expect(items.getByRole("heading", { level: 3 })).toHaveText(["Ana Lima", "Bruno Reis"]);
    await expect(items.filter({ hasText: "Ana Lima" })).toContainText("Atende Coloração, Corte feminino e Escova");
    await expect(items.filter({ hasText: "Bruno Reis" })).toContainText("Atende Barba e Corte feminino");
    await expect(page.getByText("Carla Arquivada")).toHaveCount(0);
    await expect(page).toHaveTitle(`Equipe · ${businessName}`);
    await expectNoHorizontalScroll(page);
    await shot(page, "06-equipe");

    // Nome do negócio no cabeçalho volta ao Início.
    await page.getByRole("banner").getByRole("link", { name: businessName }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    await expect(menuLink("Início")).toHaveAttribute("aria-current", "page");
  });

  await test.step("menu no lugar certo para o viewport", async () => {
    const header = page.getByRole("banner");
    const brand = await header.getByRole("link", { name: businessName }).boundingBox();
    const menu = await nav.boundingBox();
    if (isMobile) expect(menu!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
    else expect(Math.abs(menu!.y + menu!.height / 2 - (brand!.y + brand!.height / 2))).toBeLessThan(8);
  });

  await test.step("slug inexistente, reservado e subpágina inexistente: 404", async () => {
    for (const path of [`/nao-existe-${slug}`, "/admin", `/nao-existe-${slug}/servicos`, `/${slug}/agendar-x`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeVisible();
      await expect(page.getByText(businessName)).toHaveCount(0);
    }
    await expect(page).toHaveTitle("Página não encontrada · Slotz");
    await expectNoHorizontalScroll(page);
    await shot(page, "07-404");
  });

  await test.step("rotas do app continuam: /painel com sessão, /login e /cadastro sem", async () => {
    const painel = await page.goto("/painel");
    expect(painel?.status()).toBe(200);
    await expect(page).toHaveURL(/\/painel$/);
    await expect(page.getByRole("navigation", { name: "Painel" }).locator("visible=true")).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/login\?next=%2Fpainel$/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    const cadastro = await page.goto("/cadastro");
    expect(cadastro?.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Criar minha conta" })).toBeVisible();
    // O site continua aberto sem sessão.
    expect((await page.goto(`/${slug}/servicos`))?.status()).toBe(200);
    await expect(page.getByRole("list", { name: "Serviços" }).getByRole("listitem")).toHaveCount(4);
  });

  expect(consoleErrors).toEqual([]);
  const expected404 = new Set([`/nao-existe-${slug}`, "/admin", `/nao-existe-${slug}/servicos`, `/${slug}/agendar-x`]);
  expect(failedResponses.filter((entry) => !(entry.startsWith("404 GET ") && expected404.has(entry.slice(8))))).toEqual([]);
});
