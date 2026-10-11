import { randomInt } from "node:crypto";
import { expect, request as playwrightRequest, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fatia 2 (agenda-link-publico), Fase 9, guia 7a, 7b e 7c no navegador: agendar pelo site em
// passos (serviço, profissional ou "qualquer", dia e horário, dados e consentimento, confirmação
// com o link de gestão), ver, remarcar e cancelar pelo link, e dois clientes disputando o mesmo
// horário (D5, D6, D8). Um fluxo por viewport, com prints.
//
// O dono monta o catálogo pela API (contexto próprio, com sessão). Cada cliente é um contexto do
// navegador sem sessão e com um IP próprio (x-forwarded-for), como clientes reais: o limite por
// IP das rotas públicas (D8) vale para cada um separadamente.

const EVIDENCE_DIR = "docs/features/agenda-link-publico/evidencias";
const TZ = "America/Sao_Paulo";
const BASE_URL = "http://localhost:3100";

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase9-${project}-${name}.png`, fullPage: true, animations: "disabled" });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function dayInSaoPaulo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + days * 86_400_000));
}

// Dia AAAA-MM-DD + "HH:MM" em São Paulo (UTC-3, sem horário de verão desde 2019) → ISO.
function at(date: string, time: string): string {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

// "Terça-feira, 13 de outubro", como o botão do dia se anuncia.
function dayLabel(date: string): string {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fakeIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

async function newClient(browser: Browser): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const wide = test.info().project.name === "desktop";
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: TZ,
    deviceScaleFactor: 2,
    viewport: wide ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    isMobile: !wide,
    hasTouch: !wide,
    extraHTTPHeaders: { "x-forwarded-for": fakeIp() },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const dayButton = (page: Page, date: string) => page.getByRole("list", { name: "Dias" }).getByRole("button", { name: new RegExp(`^${dayLabel(date)}`) });
const timeButton = (page: Page, time: string) => page.getByRole("button", { name: time, exact: true });
const choice = (page: Page, list: string, name: string) => page.getByRole("list", { name: list }).getByRole("button", { name: new RegExp(`^${name}`) });
const summaryRow = (page: Page, label: string): Locator =>
  page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

async function pickDay(page: Page, date: string): Promise<void> {
  // A semana começa hoje; o dia pode estar na semana seguinte.
  if ((await dayButton(page, date).count()) === 0) await page.getByRole("button", { name: "Próxima semana" }).click();
  await dayButton(page, date).click();
  await expect(dayButton(page, date)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Carregando horários livres…")).toHaveCount(0);
}

async function fillCustomer(page: Page, name: string, phone: string): Promise<void> {
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone com DDD").fill(phone);
  await page.getByRole("checkbox").check();
}

test("site público: agendar, ver, remarcar e cancelar pelo link, e disputa pelo mesmo horário", async ({ browser }) => {
  test.setTimeout(480_000);
  const project = test.info().project.name;

  // ---------- Dono: negócio, catálogo e expediente pela API ----------
  const owner = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const businessName = `Studio Fase Nove ${project}`;
  expect((await owner.post("/api/auth/register", { data: { businessName, email: e2eEmail(), password: "senha-forte-123" } })).status()).toBe(201);
  const slug = ((await (await owner.get("/api/settings")).json()).settings.slug) as string;
  expect((await owner.patch("/api/settings", { data: { phone: "(13) 99999-0000" } })).status()).toBe(200);

  const createService = async (name: string, durationMinutes: number, priceCents: number) => {
    const response = await owner.post("/api/services", { data: { name, durationMinutes, priceCents } });
    expect(response.status()).toBe(201);
    return (await response.json()).service.id as string;
  };
  const corte = await createService("Corte feminino", 45, 8000);
  const barba = await createService("Barba", 30, 4000);
  const professionals: Record<string, string> = {};
  for (const [name, services] of [
    ["Ana Lima", [corte]],
    ["Bruno Reis", [corte, barba]],
  ] as const) {
    const created = await owner.post("/api/professionals", { data: { name } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).professional.id as string;
    professionals[name] = id;
    expect((await owner.put(`/api/professionals/${id}/services`, { data: { serviceIds: services } })).status()).toBe(200);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      expect((await owner.post(`/api/professionals/${id}/working-hours`, { data: { weekday, start: "09:00", end: "18:00" } })).status()).toBe(201);
    }
  }

  const day = dayInSaoPaulo(3);
  const ownerAppointments = async () => {
    const query = new URLSearchParams({ from: at(day, "00:00"), to: at(dayInSaoPaulo(4), "00:00") });
    const response = await owner.get(`/api/appointments?${query}`);
    expect(response.status()).toBe(200);
    return (await response.json()).appointments as {
      id: string;
      status: string;
      startsAt: string;
      professional: { name: string };
      customer: { name: string; phone: string };
    }[];
  };

  const client = await newClient(browser);
  const { page } = client;
  let managePath = "";

  await test.step("agendar em passos: serviço, profissional, dia e horário, dados e consentimento", async () => {
    await page.goto(`/${slug}`);
    const nav = page.getByRole("navigation", { name: "Site" }).locator("visible=true");
    await nav.getByRole("link", { name: "Agendar", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/agendar$`));
    await expect(nav.getByRole("link", { name: "Agendar", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`Agendar · ${businessName}`);
    await expect(page.getByRole("heading", { level: 1, name: "Agendar" })).toBeVisible();
    await expect(page.getByText("Passo 1 de 4")).toBeVisible();
    await expect(page.getByRole("list", { name: "Serviços" }).getByRole("button")).toHaveCount(2);
    await expect(choice(page, "Serviços", "Corte feminino")).toContainText("45 min");
    await expect(choice(page, "Serviços", "Corte feminino")).toContainText("R$ 80,00");
    await expectNoHorizontalScroll(page);
    await shot(page, "01-servico");

    await choice(page, "Serviços", "Corte feminino").click();
    await expect(heading(page, "Escolha o profissional")).toBeFocused();
    await expect(page.getByText("Passo 2 de 4")).toBeVisible();
    const team = page.getByRole("list", { name: "Profissionais" }).getByRole("button");
    await expect(team).toHaveCount(3);
    await expect(team.first()).toContainText("Qualquer profissional disponível");
    await expectNoHorizontalScroll(page);
    await shot(page, "02-profissional");

    await choice(page, "Profissionais", "Ana Lima").click();
    await expect(heading(page, "Escolha o dia e o horário")).toBeVisible();
    await expect(summaryRow(page, "Profissional")).toHaveText("Ana Lima");
    await pickDay(page, day);
    await expect(heading(page, dayLabel(day))).toBeVisible();
    await expect(page.getByRole("list", { name: "Horários livres: manhã" })).toBeVisible();
    // 09:00 a 18:00 com 45 min e grade de 15: o último início é 17:15.
    await expect(timeButton(page, "17:15")).toBeVisible();
    await expect(timeButton(page, "17:30")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "03-horario");

    await timeButton(page, "10:00").click();
    await expect(heading(page, "Seus dados")).toBeFocused();
    await expect(summaryRow(page, "Quando")).toContainText("às 10:00");
    // Sem os dados e sem o consentimento: erros nos campos, nada é gravado.
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(page.getByText("Informe seu nome.")).toBeVisible();
    await expect(page.getByText("Informe seu telefone com DDD, como (11) 98765-4321.")).toBeVisible();
    await expect(page.getByText("É preciso aceitar o uso dos seus dados para agendar.")).toBeVisible();
    await expect(page.getByLabel("Nome", { exact: true })).toBeFocused();
    expect(await ownerAppointments()).toHaveLength(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "04-dados-erros");

    await fillCustomer(page, "Marina Souza", "(13) 98888-1234");
    await page.getByLabel("E-mail (opcional)").fill("marina@exemplo.com");
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(heading(page, "Agendamento confirmado")).toBeFocused();
    await expect(page.getByText("Marina Souza, seu horário está reservado.")).toBeVisible();
    await expect(summaryRow(page, "Profissional")).toHaveText("Ana Lima");
    await expect(summaryRow(page, "Quando")).toContainText("das 10:00 às 10:45");
    await expect(page.getByText("Não enviamos o link por e-mail nem por WhatsApp.")).toBeVisible();
    const link = await page.getByLabel("Link do agendamento").inputValue();
    expect(link).toMatch(new RegExp(`^${BASE_URL}/${slug}/agendamento/[A-Za-z0-9_-]{43}$`));
    managePath = new URL(link).pathname;
    await page.getByRole("button", { name: "Copiar link" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Link copiado." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expectNoHorizontalScroll(page);
    await shot(page, "05-confirmado");

    const [created] = await ownerAppointments();
    expect(created).toMatchObject({ status: "confirmed", startsAt: at(day, "10:00"), professional: { name: "Ana Lima" } });
    expect(created.customer).toMatchObject({ name: "Marina Souza", phone: "5513988881234" });
  });

  await test.step("ver pelo link: dados, prazo e cabeçalhos sem vazamento do token", async () => {
    await page.getByRole("link", { name: "Abrir meu agendamento" }).click();
    await expect(page).toHaveURL(new RegExp(`${managePath}$`));
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page).toHaveTitle(`Seu agendamento · ${businessName}`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.getByRole("heading", { level: 1, name: "Seu agendamento" })).toBeVisible();
    await expect(page.getByText("Confirmado", { exact: true })).toBeVisible();
    await expect(page.getByText(`Marina Souza, seu horário em ${businessName} está confirmado.`)).toBeVisible();
    await expect(summaryRow(page, "Serviço")).toHaveText("Corte feminino");
    await expect(summaryRow(page, "Quando")).toContainText("das 10:00 às 10:45");
    await expect(page.getByText(/Você pode cancelar ou remarcar até \d{2}\/\d{2}\/\d{4} às 08:00\./)).toBeVisible();
    // Do cliente, só o nome: o telefone não aparece na página do link.
    await expect(page.getByText("98888")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "06-gestao");
  });

  await test.step("remarcar pelo link para outro profissional e horário", async () => {
    await page.getByRole("button", { name: "Remarcar" }).click();
    await expect(page.getByRole("heading", { name: "Remarcar" })).toBeVisible();
    // Começa no dia do agendamento atual.
    await expect(dayButton(page, day)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Bruno Reis" }).click();
    await expect(page.getByRole("button", { name: "Bruno Reis" })).toHaveAttribute("aria-pressed", "true");
    await expect(dayButton(page, day)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Carregando horários livres…")).toHaveCount(0);
    await timeButton(page, "15:00").click();
    await expect(page.getByText(/Novo horário: .*às 15:00, com Bruno Reis\./)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "07-remarcar");

    await page.getByRole("button", { name: "Confirmar remarcação" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Agendamento remarcado." })).toBeVisible();
    await expect(summaryRow(page, "Profissional")).toHaveText("Bruno Reis");
    await expect(summaryRow(page, "Quando")).toContainText("das 15:00 às 15:45");
    await expect(page.getByText(/Você pode cancelar ou remarcar até .* às 13:00\./)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "08-remarcado");

    const list = await ownerAppointments();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "confirmed", startsAt: at(day, "15:00"), professional: { name: "Bruno Reis" } });
    // O mesmo link segue valendo depois de remarcar (D6).
    await page.reload();
    await expect(summaryRow(page, "Quando")).toContainText("das 15:00 às 15:45");
  });

  await test.step("cancelar pelo link libera o horário", async () => {
    await page.getByRole("button", { name: "Cancelar agendamento" }).click();
    await expect(page.getByRole("heading", { name: "Cancelar este agendamento?" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "09-cancelar");
    await page.getByRole("button", { name: "Sim, cancelar" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Agendamento cancelado." })).toBeVisible();
    await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
    await expect(page.getByText("Marina Souza, este agendamento foi cancelado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remarcar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancelar agendamento" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Agendar outro horário" })).toHaveAttribute("href", `/${slug}/agendar`);
    await expectNoHorizontalScroll(page);
    await shot(page, "10-cancelado");

    expect((await ownerAppointments())[0].status).toBe("canceled");
    const slots = await page.request.get(
      `/api/public/${slug}/availability?${new URLSearchParams({ serviceId: corte, date: day, professionalId: professionals["Bruno Reis"] })}`,
    );
    expect((await slots.json()).slots.map((slot: { startsAt: string }) => slot.startsAt)).toContain(at(day, "15:00"));
  });

  await test.step("link inválido e prazo vencido", async () => {
    const response = await page.goto(`/${slug}/agendamento/token-que-nao-existe`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Agendamento não encontrado" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "(13) 99999-0000" })).toHaveAttribute("href", "tel:13999990000");
    await expectNoHorizontalScroll(page);
    await shot(page, "11-link-invalido");

    // Agendamento pela API pública para depois de amanhã; o dono aumenta o prazo para 30 dias.
    const booked = await page.request.post(`/api/public/${slug}/appointments`, {
      data: {
        serviceId: barba,
        professionalId: professionals["Bruno Reis"],
        startsAt: at(day, "09:00"),
        customer: { name: "Paulo Prazo", phone: "13977776666" },
        consent: true,
      },
    });
    expect(booked.status()).toBe(201);
    const { managePath: latePath } = await booked.json();
    expect((await owner.patch("/api/settings", { data: { cancelDeadlineMinutes: 43_200 } })).status()).toBe(200);
    await page.goto(latePath);
    await expect(page.getByText("O prazo para mudar pelo link terminou.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remarcar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancelar agendamento" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "12-prazo-vencido");
    expect((await owner.patch("/api/settings", { data: { cancelDeadlineMinutes: 120 } })).status()).toBe(200);
  });

  await test.step("dois clientes disputam o mesmo horário: um confirma, o outro vê o erro e os horários atualizados", async () => {
    const other = await newClient(browser);
    const contenders = [
      { page, name: "Clara Primeira", phone: "(13) 97777-1111" },
      { page: other.page, name: "Davi Segundo", phone: "(13) 97777-2222" },
    ];
    for (const contender of contenders) {
      await contender.page.goto(`/${slug}/agendar`);
      await choice(contender.page, "Serviços", "Corte feminino").click();
      await choice(contender.page, "Profissionais", "Ana Lima").click();
      await pickDay(contender.page, day);
      await timeButton(contender.page, "11:00").click();
      await expect(heading(contender.page, "Seus dados")).toBeVisible();
      await fillCustomer(contender.page, contender.name, contender.phone);
    }

    // Os dois confirmam ao mesmo tempo.
    await Promise.all(contenders.map((contender) => contender.page.getByRole("button", { name: "Confirmar agendamento" }).click()));
    const outcome = async (target: Page) => {
      await expect(heading(target, "Agendamento confirmado").or(heading(target, "Escolha o dia e o horário"))).toBeVisible();
      return (await heading(target, "Agendamento confirmado").count()) > 0 ? "won" : "lost";
    };
    const results = await Promise.all(contenders.map((contender) => outcome(contender.page)));
    expect([...results].sort()).toEqual(["lost", "won"]);
    const winner = contenders[results.indexOf("won")];
    const loser = contenders[results.indexOf("lost")];

    await expect(loser.page.getByRole("alert").filter({ hasText: "Esse horário acabou de ser reservado por outra pessoa." })).toBeVisible();
    // Volta ao mesmo dia, com os horários relidos: 11:00 sumiu (e 11:15, que encostaria nele);
    // 10:15, que termina às 11:00, continua livre.
    await expect(dayButton(loser.page, day)).toHaveAttribute("aria-pressed", "true");
    await expect(loser.page.getByText("Carregando horários livres…")).toHaveCount(0);
    await expect(timeButton(loser.page, "11:00")).toHaveCount(0);
    await expect(timeButton(loser.page, "11:15")).toHaveCount(0);
    await expect(timeButton(loser.page, "10:15")).toBeVisible();
    await expectNoHorizontalScroll(loser.page);
    await shot(winner.page, "13-disputa-confirmado");
    await shot(loser.page, "14-disputa-horarios-atualizados");

    const atEleven = (await ownerAppointments()).filter((item) => item.startsAt === at(day, "11:00") && item.status === "confirmed");
    expect(atEleven).toHaveLength(1);
    expect(atEleven[0].customer.name).toBe(winner.name);

    // Quem perdeu escolhe outro horário e confirma sem redigitar os dados.
    await timeButton(loser.page, "14:00").click();
    await expect(loser.page.getByLabel("Nome", { exact: true })).toHaveValue(loser.name);
    await loser.page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(heading(loser.page, "Agendamento confirmado")).toBeVisible();
    await shot(loser.page, "15-disputa-outro-horario");

    expect(other.errors).toEqual([]);
    await other.context.close();
  });

  expect(client.errors).toEqual([]);
  await client.context.close();
  await owner.dispose();
});
