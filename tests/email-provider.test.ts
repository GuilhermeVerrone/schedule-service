import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { EmailProviderError, FakeEmailProvider, fromAddress, resolveFromDomain, type SendEmailInput } from "@/server/email";
import { createEmailProvider, resolveEmailProviderKind } from "@/server/email/factory";
import { RESEND_API_URL, ResendEmailProvider } from "@/server/email/resend-provider";
import { emailSubject } from "@/server/outbound/email-content";
import { evaluateEmailSendPolicy } from "@/server/outbound/send-policy";

// Fase 8: adapter de e-mail (Fake e Resend), remetente, assunto, política do e-mail, fronteira do
// provedor e segredos. O fluxo de ponta a ponta está em tests/email-fallback.test.ts.

const root = fileURLToPath(new URL("..", import.meta.url));
const KEY = "re_TESTE_chave_que_nao_existe_123";
const input: SendEmailInput = {
  from: '"Studio Bela" <nao-responda@envio.exemplo.dev>',
  to: "maria@cliente.dev",
  subject: "Agendamento confirmado - Studio Bela",
  text: "Olá, Maria! Seu horário está confirmado.",
  idempotencyKey: "outbound:0190-abc",
};

type Call = { url: string; init: RequestInit };
function stubFetch(status: number, body: unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, calls };
}

async function errorOf(promise: Promise<unknown>): Promise<EmailProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EmailProviderError) return error;
    throw error;
  }
  throw new Error("não lançou");
}

describe("FakeEmailProvider", () => {
  it("guarda o e-mail enviado e respeita a chave de idempotência", async () => {
    const fake = new FakeEmailProvider();
    const first = await fake.send(input);
    const again = await fake.send({ ...input, text: "outro" });
    expect(again.externalId).toBe(first.externalId);
    expect(fake.sentEmails).toHaveLength(1);
    expect(fake.sentEmails[0]).toMatchObject({ ...input, externalId: first.externalId });
    await fake.send({ ...input, idempotencyKey: "outbound:outro" });
    expect(fake.sentEmails).toHaveLength(2);
  });

  it("destinatário sem @ é recusado", async () => {
    expect((await errorOf(new FakeEmailProvider().send({ ...input, to: "sem-arroba" }))).code).toBe("rejected");
  });
});

describe("ResendEmailProvider", () => {
  it("POST /emails com Bearer, Idempotency-Key e texto puro; devolve o id", async () => {
    const { fetch, calls } = stubFetch(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
    const result = await new ResendEmailProvider({ apiKey: KEY, fetch }).send(input);
    expect(result).toEqual({ externalId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_API_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sem chave: misconfigured, sem chamar a API", async () => {
    const { fetch, calls } = stubFetch(200, { id: "x" });
    expect((await errorOf(new ResendEmailProvider({ apiKey: " ", fetch }).send(input))).code).toBe("misconfigured");
    expect(calls).toEqual([]);
  });

  it.each([
    [401, { name: "missing_api_key" }, "misconfigured", true],
    [403, { name: "invalid_api_key" }, "misconfigured", true],
    [422, { name: "validation_error", message: "Invalid `to` field: maria@cliente.dev" }, "rejected", false],
    [400, { name: "invalid_idempotency_key" }, "rejected", false],
    [409, { name: "invalid_idempotent_request" }, "duplicate_request", false],
    [409, { name: "concurrent_idempotent_requests" }, "provider_unavailable", true],
    [429, { name: "rate_limit_exceeded" }, "provider_unavailable", true],
    [500, { name: "internal_server_error" }, "provider_unavailable", true],
    [502, "html de erro", "provider_unavailable", true],
  ] as const)("HTTP %i (%o) vira %s (retentável: %s)", async (status, body, code, retryable) => {
    const { fetch } = stubFetch(status, body);
    const error = await errorOf(new ResendEmailProvider({ apiKey: KEY, fetch }).send(input));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    // A mensagem pode ir para log: nunca leva a chave, o destinatário nem o texto.
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain(input.to);
    expect(error.message).not.toContain(input.text);
  });

  it("rede fora ou tempo esgotado: provider_unavailable", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await errorOf(new ResendEmailProvider({ apiKey: KEY, fetch: failing }).send(input))).code).toBe(
      "provider_unavailable",
    );
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    const started = Date.now();
    const error = await errorOf(new ResendEmailProvider({ apiKey: KEY, fetch: slow, timeoutMs: 50 }).send(input));
    expect(error.code).toBe("provider_unavailable");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("200 sem id: provider_unavailable", async () => {
    const { fetch } = stubFetch(200, {});
    expect((await errorOf(new ResendEmailProvider({ apiKey: KEY, fetch }).send(input))).code).toBe("provider_unavailable");
  });
});

describe("fábrica do provedor (EMAIL_PROVIDER)", () => {
  it("resend ou fake; sem valor, Fake fora de produção e erro em produção", () => {
    expect(resolveEmailProviderKind({ EMAIL_PROVIDER: "resend" })).toBe("resend");
    expect(resolveEmailProviderKind({ EMAIL_PROVIDER: " Fake " })).toBe("fake");
    expect(resolveEmailProviderKind({ NODE_ENV: "development" })).toBe("fake");
    expect(() => resolveEmailProviderKind({ NODE_ENV: "production" })).toThrow(EmailProviderError);
    expect(() => resolveEmailProviderKind({ EMAIL_PROVIDER: "sendgrid" })).toThrow(/resend ou fake/);
    expect(createEmailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY }).source).toBe("resend");
    expect(createEmailProvider({})).toBeInstanceOf(FakeEmailProvider);
  });
});

describe("remetente (EMAIL_FROM_DOMAIN) e assunto", () => {
  it("nao-responda@<domínio da env>, com o nome do negócio entre aspas", () => {
    expect(fromAddress("Studio Bela", "Envio.Exemplo.dev")).toBe('"Studio Bela" <nao-responda@envio.exemplo.dev>');
  });

  it("nome do negócio sem quebra de linha nem caracteres de cabeçalho", () => {
    expect(fromAddress('Bela "VIP" <x>\r\nBcc: a@b.c', "envio.exemplo.dev")).toBe(
      '"Bela VIP x Bcc: a@b.c" <nao-responda@envio.exemplo.dev>',
    );
    expect(fromAddress("  \n ", "envio.exemplo.dev")).toBe("nao-responda@envio.exemplo.dev");
    expect(emailSubject("appointment_confirmation", "Studio\r\nBela")).toBe("Agendamento confirmado - Studio Bela");
    expect(emailSubject("optout_confirmation", "Studio Bela")).toBe("Você não vai mais receber mensagens de Studio Bela");
  });

  it("domínio ausente ou inválido: misconfigured (o envio entra na retentativa e fica visível)", () => {
    for (const value of [undefined, "", "  ", "localhost", "envio exemplo.dev", "https://envio.exemplo.dev", "a@b.dev"]) {
      expect(() => resolveFromDomain(value)).toThrow(EmailProviderError);
    }
    expect(resolveFromDomain(" envio.exemplo.dev ")).toBe("envio.exemplo.dev");
  });
});

describe("política do e-mail: só expiração (D7) e janela (D11)", () => {
  const tz = "America/Sao_Paulo";
  const at = (hour: number) => DateTime.fromObject({ year: 2027, month: 3, day: 10, hour }, { zone: tz }).toJSDate();

  it("dentro da janela envia, sem teto nem aquecimento", () => {
    expect(evaluateEmailSendPolicy({ messageType: "optout_confirmation", dueAt: at(9), now: at(10), timezone: tz })).toEqual({
      action: "send",
    });
  });

  it("fora da janela espera as 8h; a confirmação de agendamento não espera", () => {
    const decision = evaluateEmailSendPolicy({ messageType: "optout_confirmation", dueAt: at(21), now: at(22), timezone: tz });
    expect(decision).toMatchObject({ action: "defer", reason: "outside_window" });
    if (decision.action === "defer") {
      expect(DateTime.fromJSDate(decision.until, { zone: tz }).toFormat("yyyy-MM-dd HH:mm")).toBe("2027-03-11 08:00");
    }
    expect(
      evaluateEmailSendPolicy({ messageType: "appointment_confirmation", dueAt: at(21), now: at(22), timezone: tz }),
    ).toEqual({ action: "send" });
  });

  it("mais de 24 h de atraso, ou espera que passaria disso, expira", () => {
    const dueAt = new Date(at(10).getTime() - 25 * 3_600_000);
    expect(evaluateEmailSendPolicy({ messageType: "appointment_confirmation", dueAt, now: at(10), timezone: tz })).toEqual({
      action: "expire",
      reason: "expired",
    });
    const lateDue = at(5); // 5h de ontem + 24 h passa antes das 8h de hoje
    const now = new Date(lateDue.getTime() + 23 * 3_600_000);
    expect(evaluateEmailSendPolicy({ messageType: "optout_confirmation", dueAt: lateDue, now, timezone: tz })).toEqual({
      action: "expire",
      reason: "expired",
    });
  });
});

describe("fronteira do provedor de e-mail e segredos", () => {
  const posix = (path: string) => path.split(sep).join("/");
  const listFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
  // Início de palavra: `compareSendOrder` não conta.
  const RESEND = /\bresend/i;

  it("fora de src/server/email/, nenhum arquivo de src/ ou scripts/ referencia o Resend", () => {
    const files = ["src", "scripts"]
      .flatMap((dir) => listFiles(join(root, dir)))
      .map((path) => posix(relative(root, path)))
      .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !file.startsWith("src/generated/"));
    expect(files).toContain("src/server/email/resend-provider.ts");
    const violations = files.filter(
      (file) => !file.startsWith("src/server/email/") && RESEND.test(readFileSync(join(root, file), "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it(".env.example tem EMAIL_FROM_DOMAIN, EMAIL_PROVIDER e RESEND_API_KEY, todos sem valor", () => {
    const entries = readFileSync(join(root, ".env.example"), "utf8")
      .split("\n")
      .filter((line) => /^\s*[A-Z_]+\s*=/.test(line))
      .map((line) => line.split("=").map((part) => part.trim()));
    const byName = new Map(entries.map(([name, value]) => [name, value]));
    for (const name of ["EMAIL_FROM_DOMAIN", "EMAIL_PROVIDER", "RESEND_API_KEY"]) expect(byName.get(name)).toBe("");
  });

  it("nenhum arquivo do código tem chave do Resend escrita (formato re_...)", () => {
    const files = ["src", "scripts", "tests", "prisma", "docs"]
      .flatMap((dir) => listFiles(join(root, dir)))
      .map((path) => posix(relative(root, path)))
      .filter((file) => !file.startsWith("src/generated/") && file !== "tests/email-provider.test.ts")
      .filter((file) => !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pdf)$/i.test(file));
    const KEY_PATTERN = /\bre_[A-Za-z0-9_]{20,}\b/;
    expect(KEY_PATTERN.test(KEY)).toBe(true); // a varredura enxerga uma chave
    expect(files.filter((file) => KEY_PATTERN.test(readFileSync(join(root, file), "utf8")))).toEqual([]);
  });
});
