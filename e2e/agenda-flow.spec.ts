import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eEmail } from "./accounts";

// Fatia 2 (agenda-link-publico), Fase 7, guia 7d no navegador: /painel/agenda com dia e semana
// (lista no celular), agendamento manual, conflito de horário como erro claro, remarcar, concluir,
// cancelar, criar e remover bloqueio (D4, D9). Um fluxo por viewport, com prints.

const EVIDENCE_DIR = "docs/features/agenda-link-publico/evidencias";
const TZ = "America/Sao_Paulo";
const LIST_API = (url: URL) => url.pathname === "/api/appointments" && url.searchParams.has("from");

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE_DIR}/fase7-${project}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function toastWith(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function waitToastsGone(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.mouse.move(1, viewport.height - 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
}

function dayInSaoPaulo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + days * 86_400_000));
}

// Dia AAAA-MM-DD + "HH:MM" em São Paulo (UTC-3, sem horário de verão desde 2019) → ISO.
function at(date: string, time: string): string {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

// Linha da lista do dia (ou da semana no celular) com o texto dado.
function row(page: Page, text: string): Locator {
  return page.locator("main ol > li").filter({ hasText: text });
}

test("agenda: dia, semana, agendamento manual, conflito, remarcar, concluir, cancelar e bloqueios", async ({ page }) => {
  test.setTimeout(420_000);
  const project = test.info().project.name;
  const wide = project === "desktop";
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });

  const register = await page.request.post("/api/auth/register", {
    data: { businessName: `Estúdio Agenda ${project}`, email: e2eEmail(), password: "senha-forte-123" },
  });
  expect(register.status()).toBe(201);

  // Catálogo pela API (telas da Fatia 1): Corte de 30 min, Ana e Bruno, 09:00 às 18:00 todo dia.
  const service = await page.request.post("/api/services", { data: { name: "Corte", durationMinutes: 30, priceCents: 5000 } });
  expect(service.status()).toBe(201);
  const serviceId = (await service.json()).service.id as string;
  const professionals: Record<string, string> = {};
  for (const name of ["Ana", "Bruno"]) {
    const created = await page.request.post("/api/professionals", { data: { name } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).professional.id as string;
    professionals[name] = id;
    expect((await page.request.put(`/api/professionals/${id}/services`, { data: { serviceIds: [serviceId] } })).status()).toBe(200);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const hours = await page.request.post(`/api/professionals/${id}/working-hours`, { data: { weekday, start: "09:00", end: "18:00" } });
      expect(hours.status()).toBe(201);
    }
  }

  const day = dayInSaoPaulo(7);
  const book = async (professional: string, time: string, name: string, phone: string) => {
    const response = await page.request.post("/api/appointments", {
      data: { professionalId: professionals[professional], serviceId, startsAt: at(day, time), contact: { name, phone } },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).appointment.id as string;
  };
  const appointmentsOfDay = async () => {
    const query = new URLSearchParams({ from: at(day, "00:00"), to: at(dayInSaoPaulo(8), "00:00") });
    const response = await page.request.get(`/api/appointments?${query}`);
    expect(response.status()).toBe(200);
    return (await response.json()).appointments as { contact: { name: string }; status: string; startsAt: string; professional: { name: string } }[];
  };
  const slotsOfAna = async () => {
    const response = await page.request.get(`/api/availability?serviceId=${serviceId}&professionalId=${professionals.Ana}&date=${day}`);
    return ((await response.json()).slots as { startsAt: string }[]).map((slot) => slot.startsAt);
  };

  const newForm = page.getByRole("form", { name: "Novo agendamento" });

  await test.step("menu leva à agenda; dia de hoje vazio", async () => {
    await page.goto("/painel");
    await page.getByRole("link", { name: "Agenda", exact: true }).locator("visible=true").click();
    await expect(page).toHaveURL(/\/painel\/agenda$/);
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Agenda", exact: true }).locator("visible=true")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Nenhum agendamento neste dia.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Dia", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Hoje" })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await shot(page, "01-dia-vazio");
  });

  await test.step("estado carregando e de erro", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(LIST_API, async (route) => {
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Carregando agenda…" })).toBeAttached();
    await shot(page, "02-carregando");
    release();
    await expect(page.getByText("Nenhum agendamento neste dia.")).toBeVisible();
    await page.unroute(LIST_API);

    await page.route(LIST_API, (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar." })).toContainText("Verifique a internet");
    await expectNoHorizontalScroll(page);
    await shot(page, "03-erro");
    await page.unroute(LIST_API);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByText("Nenhum agendamento neste dia.")).toBeVisible();
    await page.getByRole("button", { name: "Hoje" }).click();
  });

  await test.step("novo agendamento: erros de campo antes de enviar", async () => {
    await page.getByRole("button", { name: "Novo agendamento" }).click();
    await expect(newForm.getByLabel("Serviço")).toBeFocused();
    await newForm.getByLabel("Telefone").fill("1234");
    await newForm.getByRole("button", { name: "Agendar" }).click();
    await expect(newForm.getByText("Informe o horário ou escolha um dos horários livres.")).toBeVisible();
    await expect(newForm.getByText("Informe o nome do cliente.")).toBeVisible();
    await expect(newForm.getByText("Informe o telefone com DDD, por exemplo (11) 98765-4321.")).toBeVisible();
    await expect(newForm.getByLabel("Horário", { exact: true })).toBeFocused();
    expect(await appointmentsOfDay()).toHaveLength(0);
  });

  await test.step("novo agendamento pelos horários livres", async () => {
    await newForm.getByLabel("Profissional").selectOption({ label: "Ana" });
    await newForm.getByLabel("Dia", { exact: true }).fill(day);
    await newForm.getByRole("button", { name: "09:00", exact: true }).click();
    await expect(newForm.getByRole("button", { name: "09:00", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(newForm.getByLabel("Horário", { exact: true })).toHaveValue("09:00");
    await newForm.getByLabel("Nome do cliente").fill("Maria Souza");
    await newForm.getByLabel("Telefone").fill("(11) 98765-4321");
    await expectNoHorizontalScroll(page);
    await shot(page, "04-novo-agendamento");
    await newForm.getByRole("button", { name: "Agendar" }).click();
    await expect(toastWith(page, "Agendamento criado: Maria Souza")).toBeVisible();
    await expect(newForm).toHaveCount(0);
    // A tela vai para o dia do agendamento, com a linha aberta.
    const maria = row(page, "Maria Souza");
    await expect(maria).toContainText("09:00");
    await expect(maria.getByRole("button", { name: /Maria Souza/ })).toHaveAttribute("aria-expanded", "true");
    await expect(maria).toContainText("(11) 98765-4321");
    // Telefone guardado em E.164 (Fatia 3, D2): o link de ligar usa o número como está.
    await expect(maria.getByRole("link", { name: "(11) 98765-4321" })).toHaveAttribute("href", "tel:+5511987654321");
    await expect(maria).toContainText("Corte, 30 min, R$ 50,00");
    const saved = await appointmentsOfDay();
    expect(saved.map((item) => [item.contact.name, item.status, item.startsAt, item.professional.name])).toEqual([
      ["Maria Souza", "confirmed", at(day, "09:00"), "Ana"],
    ]);
    await expectNoHorizontalScroll(page);
    await shot(page, "05-agendamento-criado");
    await waitToastsGone(page);
  });

  await test.step("conflito de horário: erro claro e horários livres atualizados", async () => {
    // Horário já ocupado, digitado à mão.
    await page.getByRole("button", { name: "Novo agendamento" }).click();
    await newForm.getByLabel("Profissional").selectOption({ label: "Ana" });
    await expect(newForm.getByLabel("Dia", { exact: true })).toHaveValue(day);
    await expect(newForm.getByRole("button", { name: "09:30", exact: true })).toBeVisible();
    await expect(newForm.getByRole("button", { name: "09:00", exact: true })).toHaveCount(0);
    await newForm.getByLabel("Horário", { exact: true }).fill("09:00");
    await newForm.getByLabel("Nome do cliente").fill("Carlos Lima");
    await newForm.getByLabel("Telefone").fill("11 91234-5678");
    await newForm.getByRole("button", { name: "Agendar" }).click();
    const alert = newForm.getByRole("alert");
    await expect(alert).toContainText("Esse horário não está livre para Ana");
    await expect(alert).toContainText("Escolha outro horário livre.");
    await expect(newForm.getByLabel("Horário", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(newForm.getByText("Escolha outro horário.")).toBeVisible();

    // Corrida: o 10:00 aparece livre, mas outro agendamento o ocupa antes do envio.
    await expect(newForm.getByRole("button", { name: "10:00", exact: true })).toBeVisible();
    await newForm.getByRole("button", { name: "10:00", exact: true }).click();
    await book("Ana", "10:00", "Outro Cliente", "11955554444");
    await newForm.getByRole("button", { name: "Agendar" }).click();
    await expect(alert).toContainText("Esse horário não está livre para Ana");
    // Os horários livres são recarregados: o 10:00 some.
    await expect(newForm.getByRole("button", { name: "10:00", exact: true })).toHaveCount(0);
    await expect(newForm.getByRole("button", { name: "10:30", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "06-conflito");
    expect((await appointmentsOfDay()).map((item) => item.contact.name)).toEqual(["Maria Souza", "Outro Cliente"]);
    await newForm.getByRole("button", { name: "Cancelar" }).click();
    await expect(newForm).toHaveCount(0);
  });

  // Mais agendamentos pela API para concluir e cancelar.
  await book("Ana", "14:00", "Pedro Alves", "11933332222");
  await book("Bruno", "09:00", "Joana Reis", "11977776666");
  await page.reload();
  await page.getByRole("button", { name: "Próximo dia" }).waitFor();
  for (let index = 0; index < 7; index += 1) await page.getByRole("button", { name: "Próximo dia" }).click();
  await expect(row(page, "Joana Reis")).toBeVisible();

  await test.step("remarcar: conflito e depois sucesso", async () => {
    const maria = row(page, "Maria Souza");
    await maria.getByRole("button", { name: /Maria Souza/ }).click();
    await maria.getByRole("button", { name: "Remarcar" }).click();
    const form = page.getByRole("form", { name: "Remarcar Maria Souza" });
    await expect(form.getByLabel("Novo dia")).toHaveValue(day);
    await form.getByLabel("Novo horário").fill("14:00");
    await form.getByRole("button", { name: "Remarcar" }).click();
    await expect(form.getByRole("alert")).toContainText("Esse horário não está livre para Ana");
    await expectNoHorizontalScroll(page);
    await shot(page, "07-remarcar-conflito");
    expect((await appointmentsOfDay()).find((item) => item.contact.name === "Maria Souza")?.startsAt).toBe(at(day, "09:00"));

    await form.getByRole("button", { name: "11:00", exact: true }).click();
    await form.getByRole("button", { name: "Remarcar" }).click();
    await expect(toastWith(page, "Remarcado: Maria Souza")).toBeVisible();
    await expect(row(page, "Maria Souza")).toContainText("11:00");
    expect((await appointmentsOfDay()).find((item) => item.contact.name === "Maria Souza")?.startsAt).toBe(at(day, "11:00"));
    // O horário antigo ficou livre e o novo, ocupado.
    const slots = await slotsOfAna();
    expect(slots).toContain(at(day, "09:00"));
    expect(slots).not.toContain(at(day, "11:00"));
    await waitToastsGone(page);
  });

  await test.step("concluir e cancelar", async () => {
    const pedro = row(page, "Pedro Alves");
    await pedro.getByRole("button", { name: /Pedro Alves/ }).click();
    await pedro.getByRole("button", { name: "Marcar como concluído" }).click();
    await expect(toastWith(page, "Atendimento de Pedro Alves marcado como concluído.")).toBeVisible();
    await expect(pedro.getByText("Concluído").locator("visible=true").first()).toBeVisible();
    await expect(pedro.getByRole("button", { name: "Marcar como concluído" })).toHaveCount(0);

    const joana = row(page, "Joana Reis");
    await joana.getByRole("button", { name: /Joana Reis/ }).click();
    await joana.getByRole("button", { name: "Cancelar agendamento" }).click();
    await expect(joana.getByRole("group", { name: "Confirmar cancelamento" })).toContainText("Cancelar o agendamento de Joana Reis às 09:00?");
    await joana.getByRole("button", { name: "Sim, cancelar" }).click();
    await expect(toastWith(page, "Agendamento de Joana Reis cancelado.")).toBeVisible();
    await expect(joana.getByText("Cancelado").locator("visible=true").first()).toBeVisible();
    await expect(joana.getByRole("button", { name: "Cancelar agendamento" })).toHaveCount(0);

    const statuses = Object.fromEntries((await appointmentsOfDay()).map((item) => [item.contact.name, item.status]));
    expect(statuses).toEqual({ "Maria Souza": "confirmed", "Outro Cliente": "confirmed", "Pedro Alves": "completed", "Joana Reis": "canceled" });
    await expect(page.getByText("3 agendamentos")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "08-concluido-cancelado");
    await waitToastsGone(page);
  });

  await test.step("bloqueio: validação, criar e remover", async () => {
    await page.getByRole("button", { name: "Bloquear horário" }).click();
    const form = page.getByRole("form", { name: "Bloquear horário" });
    await form.getByLabel("Profissional").selectOption({ label: "Ana" });
    await expect(form.getByLabel("Dia", { exact: true })).toHaveValue(day);
    await form.getByLabel("Início").fill("13:00");
    await form.getByLabel("Fim").fill("12:00");
    await form.getByRole("button", { name: "Bloquear" }).click();
    await expect(form.getByText("O fim deve ser depois do início.")).toBeVisible();

    await form.getByLabel("Início").fill("12:00");
    await form.getByLabel("Fim").fill("13:00");
    await form.getByLabel("Motivo").fill("Almoço");
    await form.getByRole("button", { name: "Bloquear" }).click();
    await expect(toastWith(page, "Horário bloqueado: Ana")).toBeVisible();
    const block = row(page, "Horário bloqueado");
    await expect(block).toContainText("12:00");
    await expect(block).toContainText("Ana · Almoço");
    let slots = await slotsOfAna();
    expect(slots).not.toContain(at(day, "12:00"));
    expect(slots).not.toContain(at(day, "12:30"));
    expect(slots).toContain(at(day, "13:00"));
    await expectNoHorizontalScroll(page);
    await shot(page, "09-bloqueio");
    await waitToastsGone(page);

    await block.getByRole("button", { name: "Remover bloqueio" }).click();
    await expect(toastWith(page, "Bloqueio de Ana das 12:00 às 13:00 removido.")).toBeVisible();
    await expect(row(page, "Horário bloqueado")).toHaveCount(0);
    slots = await slotsOfAna();
    expect(slots).toContain(at(day, "12:00"));
    await waitToastsGone(page);
  });

  await test.step("semana: colunas no desktop, lista por dia no celular", async () => {
    await page.getByRole("button", { name: "Semana", exact: true }).click();
    await expect(page.getByRole("button", { name: "Semana", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Próxima semana" })).toBeVisible();
    if (wide) {
      const columns = page.locator("main section[aria-label]");
      await expect(columns).toHaveCount(7);
      const item = page.getByRole("button", { name: /^11:00, Maria Souza, Corte · Ana, Confirmado$/ });
      await expect(item).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, "10-semana");
      // Clicar no item leva ao dia, com a linha aberta.
      await item.click();
      await expect(page.getByRole("button", { name: "Dia", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(row(page, "Maria Souza").getByRole("button", { name: /Maria Souza/ })).toHaveAttribute("aria-expanded", "true");
    } else {
      await expect(page.locator("main section h3")).toHaveCount(7);
      await expect(row(page, "Maria Souza")).toContainText("11:00");
      await expect(row(page, "Joana Reis")).toContainText("Cancelado");
      await expectNoHorizontalScroll(page);
      await shot(page, "10-semana");
      // Na lista do celular a linha abre no lugar.
      await row(page, "Maria Souza").getByRole("button", { name: /Maria Souza/ }).click();
      await expect(row(page, "Maria Souza").getByRole("button", { name: "Remarcar" })).toBeVisible();
      await page.getByRole("button", { name: "Dia", exact: true }).click();
    }
  });

  await test.step("filtro por profissional", async () => {
    await page.getByLabel("Profissional", { exact: true }).selectOption({ label: "Bruno" });
    await expect(row(page, "Joana Reis")).toBeVisible();
    await expect(row(page, "Maria Souza")).toHaveCount(0);
    await expect(page.getByText("0 agendamentos")).toBeVisible();
    await page.getByLabel("Profissional", { exact: true }).selectOption({ label: "Todos os profissionais" });
    await expect(row(page, "Maria Souza")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "11-dia-completo");
  });

  await test.step("tokens do DESIGN.md", async () => {
    const h1 = await page.getByRole("heading", { level: 1 }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, weight: style.fontWeight, color: style.color };
    });
    expect(h1.family).toMatch(/Poppins/i);
    expect(h1.weight).toBe("600");
    expect(h1.color).toBe("rgb(38, 34, 35)");
    const primary = await page.getByRole("button", { name: "Novo agendamento" }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { bg: style.backgroundColor, height: style.height, radius: style.borderRadius, family: style.fontFamily, weight: style.fontWeight };
    });
    expect(primary).toMatchObject({ bg: "rgb(73, 45, 235)", height: "52px", radius: "10px", weight: "600" });
    expect(primary.family).toMatch(/Manrope/i);
    const pressed = await page.getByRole("button", { name: "Dia", exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, height: style.height };
    });
    expect(pressed.color).toBe("rgb(68, 52, 158)");
    // Alvos de toque de pelo menos 40px.
    for (const name of ["Dia anterior", "Próximo dia", "Hoje", "Semana"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
  });

  expect(consoleErrors).toEqual([]);
  // Só os 409 provocados de propósito (2 no agendamento, 1 na remarcação).
  const normalized = failedResponses.map((entry) => entry.replace(/\/appointments\/[^/]+\//, "/appointments/:id/")).sort();
  expect(normalized).toEqual(["409 POST /api/appointments", "409 POST /api/appointments", "409 POST /api/appointments/:id/reschedule"]);
});
