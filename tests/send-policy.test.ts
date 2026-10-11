import { describe, expect, it } from "vitest";
import {
  compareSendOrder,
  dailyLimit,
  evaluateSendPolicy,
  isWithinSendWindow,
  MATURE_DAILY_LIMIT,
  nextSendAllowedAt,
  randomSendIntervalMs,
  SEND_EXPIRY_MS,
  SEND_INTERVAL_MAX_MS,
  SEND_INTERVAL_MIN_MS,
  sendPriority,
  tenantDay,
  usedToday,
  warmupDay,
  warmupLimit,
  warmupStatus,
  type SendPolicyInput,
} from "@/server/outbound/send-policy";

// Fase 4: política de envio, pura e sem Redis (guia 6, 7e; D3, D7, D9, D11, D14). São Paulo é
// UTC-3 o ano todo; Tóquio é UTC+9 e Manaus UTC-4, para provar que o dia e a janela seguem o
// fuso do tenant e não o de São Paulo nem o UTC.

const SP = "America/Sao_Paulo";
const TOKYO = "Asia/Tokyo";
const MANAUS = "America/Manaus";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const utc = (iso: string) => new Date(iso);

// 2026-10-11 10:00 em São Paulo.
const NOW = utc("2026-10-11T13:00:00.000Z");
const MATURE = utc("2026-09-01T12:00:00.000Z");

const input = (over: Partial<SendPolicyInput> = {}): SendPolicyInput => ({
  messageType: "optout_confirmation",
  dueAt: NOW,
  now: NOW,
  timezone: SP,
  firstConnectedAt: MATURE,
  manualLimit: null,
  counter: { sentCount: 0, countDate: null },
  ...over,
});

describe("intervalo aleatório entre envios (8 a 25 s)", () => {
  it("as pontas do sorteio caem em 8 s e 25 s", () => {
    expect(randomSendIntervalMs(() => 0)).toBe(SEND_INTERVAL_MIN_MS);
    expect(randomSendIntervalMs(() => 0.999_999_999)).toBe(SEND_INTERVAL_MAX_MS);
    expect(SEND_INTERVAL_MIN_MS).toBe(8_000);
    expect(SEND_INTERVAL_MAX_MS).toBe(25_000);
  });

  it("com Math.random, 5.000 sorteios ficam todos entre 8 e 25 s, inteiros e variados", () => {
    const values = Array.from({ length: 5_000 }, () => randomSendIntervalMs());
    expect(values.every((v) => Number.isInteger(v) && v >= 8_000 && v <= 25_000)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1_000);
  });

  it("próximo envio permitido = envio + intervalo; antes disso a mensagem espera", () => {
    const allowed = nextSendAllowedAt(NOW, () => 0.5);
    expect(allowed.getTime() - NOW.getTime()).toBe(16_500);
    const early = new Date(allowed.getTime() - 1);
    expect(evaluateSendPolicy(input({ now: early, notBefore: allowed }))).toEqual({
      action: "defer",
      reason: "interval",
      until: allowed,
    });
    expect(evaluateSendPolicy(input({ now: allowed, notBefore: allowed })).action).toBe("send");
  });
});

describe("curva de aquecimento (14 dias, D3)", () => {
  // Primeira conexão em 2026-10-01 09:00 de São Paulo; dia N = 2026-10-(N) 10:00.
  const first = utc("2026-10-01T12:00:00.000Z");
  const onDay = (n: number) => new Date(first.getTime() + (n - 1) * DAY + HOUR);
  const expected: [number, number][] = [
    [1, 20], [2, 20], [3, 40], [4, 40], [5, 80], [6, 80], [7, 120], [8, 120],
    [9, 160], [10, 160], [11, 200], [12, 200], [13, 200], [14, 200], [15, 200], [60, 200],
  ];

  it.each(expected)("dia %i: limite %i", (day, limit) => {
    expect(warmupDay(first, onDay(day), SP)).toBe(day);
    expect(warmupLimit(day)).toBe(limit);
    expect(dailyLimit({ firstConnectedAt: first, manualLimit: null, now: onDay(day), timezone: SP })).toBe(limit);
  });

  it("cada degrau vira exatamente na meia-noite do fuso do tenant", () => {
    // Dia 2 → 3: 2026-10-02 23:59:59.999 ainda 20; 2026-10-03 00:00 já 40 (São Paulo).
    expect(dailyLimit({ firstConnectedAt: first, manualLimit: null, now: utc("2026-10-03T02:59:59.999Z"), timezone: SP })).toBe(20);
    expect(dailyLimit({ firstConnectedAt: first, manualLimit: null, now: utc("2026-10-03T03:00:00.000Z"), timezone: SP })).toBe(40);
  });

  it("dias contados no calendário do tenant: conectou às 23h30, 00h30 já é o dia 2", () => {
    const lateFirst = utc("2026-10-02T02:30:00.000Z"); // 2026-10-01 23:30 em SP
    expect(warmupDay(lateFirst, utc("2026-10-02T03:30:00.000Z"), SP)).toBe(2);
    // Em Tóquio o mesmo instante é 2026-10-02 11:30 e 12:30: mesmo dia.
    expect(warmupDay(lateFirst, utc("2026-10-02T03:30:00.000Z"), TOKYO)).toBe(1);
  });

  it("sem primeira conexão: dia 1, o limite mais baixo", () => {
    expect(warmupDay(null, NOW, SP)).toBe(1);
    expect(dailyLimit({ firstConnectedAt: null, manualLimit: null, now: NOW, timezone: SP })).toBe(20);
  });

  it("relógio antes da primeira conexão não dá dia 0 nem negativo", () => {
    expect(warmupDay(utc("2026-10-20T12:00:00.000Z"), NOW, SP)).toBe(1);
  });

  it("fase do aquecimento: dentro até o dia 14, madura a partir do 15", () => {
    expect(warmupStatus({ firstConnectedAt: first, manualLimit: null, now: onDay(14), timezone: SP })).toEqual({
      day: 14,
      inWarmup: true,
      limit: MATURE_DAILY_LIMIT,
    });
    expect(warmupStatus({ firstConnectedAt: first, manualLimit: null, now: onDay(15), timezone: SP }).inWarmup).toBe(false);
  });

  it("reconexão não zera: o limite só depende da primeira conexão, não da última", () => {
    // Caiu e reconectou no dia 9: a primeira conexão continua a mesma, então segue no dia 9 (160).
    const status = warmupStatus({ firstConnectedAt: first, manualLimit: null, now: onDay(9), timezone: SP });
    expect(status).toEqual({ day: 9, inWarmup: true, limit: 160 });
  });
});

describe("teto manual opcional (D14)", () => {
  it("abaixo da curva: vale o teto manual", () => {
    expect(dailyLimit({ firstConnectedAt: MATURE, manualLimit: 50, now: NOW, timezone: SP })).toBe(50);
  });

  it("acima da curva: não sobe o limite (o aquecimento continua mandando)", () => {
    const first = utc("2026-10-10T12:00:00.000Z"); // dia 2
    expect(dailyLimit({ firstConnectedAt: first, manualLimit: 500, now: NOW, timezone: SP })).toBe(20);
  });

  it("nulo: sem teto manual", () => {
    expect(dailyLimit({ firstConnectedAt: MATURE, manualLimit: null, now: NOW, timezone: SP })).toBe(200);
  });

  it("teto manual atingido adia como teto diário", () => {
    const decision = evaluateSendPolicy(input({ manualLimit: 5, counter: { sentCount: 5, countDate: "2026-10-11" } }));
    expect(decision).toMatchObject({ action: "defer", reason: "daily_limit" });
  });
});

describe("dia do teto no fuso do tenant (D9)", () => {
  it("tenantDay segue o fuso: o mesmo instante é outro dia em Tóquio e em Manaus", () => {
    const instant = utc("2026-10-11T23:30:00.000Z");
    expect(tenantDay(instant, SP)).toBe("2026-10-11"); // 20:30
    expect(tenantDay(instant, MANAUS)).toBe("2026-10-11"); // 19:30
    expect(tenantDay(instant, TOKYO)).toBe("2026-10-12"); // 08:30 do dia seguinte
  });

  it("contador de outro dia vale zero", () => {
    expect(usedToday({ sentCount: 200, countDate: "2026-10-10" }, "2026-10-11")).toBe(0);
    expect(usedToday({ sentCount: 7, countDate: "2026-10-11" }, "2026-10-11")).toBe(7);
    expect(usedToday({ sentCount: 0, countDate: null }, "2026-10-11")).toBe(0);
  });

  it("Tóquio: teto cheio no dia 11 libera à meia-noite de Tóquio (15:00 UTC), não à de São Paulo", () => {
    const full = { sentCount: 200, countDate: "2026-10-11" };
    const type = "appointment_confirmation" as const; // fora da janela, para isolar a virada do dia
    const beforeMidnight = utc("2026-10-11T14:59:59.999Z"); // 23:59:59.999 em Tóquio
    const atMidnight = utc("2026-10-11T15:00:00.000Z"); // 00:00 de 12/10 em Tóquio; 12:00 de 11/10 em SP
    const base = { messageType: type, timezone: TOKYO, counter: full };
    expect(evaluateSendPolicy(input({ ...base, now: beforeMidnight, dueAt: beforeMidnight }))).toEqual({
      action: "defer",
      reason: "daily_limit",
      until: atMidnight,
    });
    expect(evaluateSendPolicy(input({ ...base, now: atMidnight, dueAt: beforeMidnight }))).toEqual({
      action: "send",
      day: "2026-10-12",
      limit: 200,
    });
    // O mesmo instante em São Paulo ainda é o dia 11: segue bloqueado.
    expect(evaluateSendPolicy(input({ ...base, timezone: SP, now: atMidnight, dueAt: atMidnight })).action).toBe("defer");
  });

  it("Manaus: 00:30 UTC já é o dia 12 em São Paulo, mas ainda é o dia 11 em Manaus", () => {
    const now = utc("2026-10-12T03:30:00.000Z"); // 23:30 de 11/10 em Manaus; 00:30 de 12/10 em SP
    const full = { sentCount: 200, countDate: "2026-10-11" };
    const type = "appointment_confirmation" as const;
    expect(evaluateSendPolicy(input({ messageType: type, timezone: MANAUS, now, dueAt: now, counter: full }))).toEqual({
      action: "defer",
      reason: "daily_limit",
      until: utc("2026-10-12T04:00:00.000Z"),
    });
    expect(evaluateSendPolicy(input({ messageType: type, timezone: SP, now, dueAt: now, counter: full })).action).toBe(
      "send",
    );
  });

  it("fuso inválido é erro, não um dia em UTC", () => {
    expect(() => tenantDay(NOW, "Lugar/Nenhum")).toThrow(RangeError);
  });
});

describe("teto atingido (D7)", () => {
  it("abaixo do teto: envia e devolve o dia e o limite para o contador atômico", () => {
    expect(evaluateSendPolicy(input({ counter: { sentCount: 199, countDate: "2026-10-11" } }))).toEqual({
      action: "send",
      day: "2026-10-11",
      limit: 200,
    });
  });

  it("no teto: adia para o dia seguinte às 8h (mensagem comum)", () => {
    expect(evaluateSendPolicy(input({ counter: { sentCount: 200, countDate: "2026-10-11" } }))).toEqual({
      action: "defer",
      reason: "daily_limit",
      until: utc("2026-10-12T11:00:00.000Z"), // 08:00 de 12/10 em SP
    });
  });

  it("no teto: confirmação de agendamento sai à meia-noite (não espera a janela)", () => {
    const decision = evaluateSendPolicy(
      input({ messageType: "appointment_confirmation", counter: { sentCount: 200, countDate: "2026-10-11" } }),
    );
    expect(decision).toEqual({ action: "defer", reason: "daily_limit", until: utc("2026-10-12T03:00:00.000Z") });
  });

  it("no teto do aquecimento (dia 1, 20 envios)", () => {
    const first = utc("2026-10-11T12:00:00.000Z");
    const decision = evaluateSendPolicy(input({ firstConnectedAt: first, counter: { sentCount: 20, countDate: "2026-10-11" } }));
    expect(decision).toMatchObject({ action: "defer", reason: "daily_limit" });
  });

  it("teto de ontem cheio não bloqueia hoje", () => {
    expect(evaluateSendPolicy(input({ counter: { sentCount: 200, countDate: "2026-10-10" } })).action).toBe("send");
  });
});

describe("janela de 8h às 20h (D11)", () => {
  const at = (iso: string) => utc(iso);

  it.each([
    ["07:59:59.999", "2026-10-11T10:59:59.999Z", false],
    ["08:00", "2026-10-11T11:00:00.000Z", true],
    ["19:59:59.999", "2026-10-11T22:59:59.999Z", true],
    ["20:00", "2026-10-11T23:00:00.000Z", false],
    ["03:00", "2026-10-11T06:00:00.000Z", false],
  ])("%s em São Paulo: dentro = %s", (_label, iso, inside) => {
    expect(isWithinSendWindow(at(iso), SP)).toBe(inside);
  });

  it("antes das 8h: espera as 8h do mesmo dia", () => {
    const now = at("2026-10-11T09:30:00.000Z"); // 06:30
    expect(evaluateSendPolicy(input({ now, dueAt: now }))).toEqual({
      action: "defer",
      reason: "outside_window",
      until: at("2026-10-11T11:00:00.000Z"),
    });
  });

  it("a partir das 20h: espera as 8h do dia seguinte", () => {
    const now = at("2026-10-11T23:00:00.000Z"); // 20:00
    expect(evaluateSendPolicy(input({ now, dueAt: now }))).toEqual({
      action: "defer",
      reason: "outside_window",
      until: at("2026-10-12T11:00:00.000Z"),
    });
  });

  it("a janela segue o fuso do tenant: 10:00 em SP é 22:00 em Tóquio", () => {
    expect(evaluateSendPolicy(input()).action).toBe("send");
    expect(evaluateSendPolicy(input({ timezone: TOKYO }))).toEqual({
      action: "defer",
      reason: "outside_window",
      until: at("2026-10-11T23:00:00.000Z"), // 08:00 de 12/10 em Tóquio
    });
  });
});

describe("prioridade da confirmação de agendamento (D7, D11)", () => {
  it("fora da janela, a confirmação sai na hora; as outras esperam", () => {
    const now = utc("2026-10-12T01:00:00.000Z"); // 22:00 em SP
    expect(evaluateSendPolicy(input({ messageType: "appointment_confirmation", now, dueAt: now }))).toEqual({
      action: "send",
      day: "2026-10-11",
      limit: 200,
    });
    expect(evaluateSendPolicy(input({ messageType: "optout_confirmation", now, dueAt: now })).action).toBe("defer");
  });

  it("a confirmação tem a prioridade mais alta da fila", () => {
    expect(sendPriority("appointment_confirmation")).toBe(1);
    expect(sendPriority("appointment_confirmation")).toBeLessThan(sendPriority("optout_confirmation"));
  });

  it("na saída do adiamento: confirmação primeiro, depois as outras em ordem de chegada", () => {
    const t = (min: number) => new Date(NOW.getTime() + min * 60_000);
    const waiting = [
      { id: "optout-1", messageType: "optout_confirmation" as const, dueAt: t(1) },
      { id: "conf-2", messageType: "appointment_confirmation" as const, dueAt: t(5) },
      { id: "optout-0", messageType: "optout_confirmation" as const, dueAt: t(0) },
      { id: "conf-1", messageType: "appointment_confirmation" as const, dueAt: t(3) },
    ];
    expect([...waiting].sort(compareSendOrder).map((m) => m.id)).toEqual(["conf-1", "conf-2", "optout-0", "optout-1"]);
  });

  it("a confirmação respeita o teto: prioridade não fura o limite", () => {
    const decision = evaluateSendPolicy(
      input({ messageType: "appointment_confirmation", counter: { sentCount: 200, countDate: "2026-10-11" } }),
    );
    expect(decision.action).toBe("defer");
  });
});

describe("expiração após 24 h (D7)", () => {
  it("exatamente 24 h de atraso ainda envia; 24 h + 1 ms expira", () => {
    expect(evaluateSendPolicy(input({ dueAt: new Date(NOW.getTime() - SEND_EXPIRY_MS) })).action).toBe("send");
    expect(evaluateSendPolicy(input({ dueAt: new Date(NOW.getTime() - SEND_EXPIRY_MS - 1) }))).toEqual({
      action: "expire",
      reason: "expired",
    });
  });

  it("expiração vence teto e janela", () => {
    const now = utc("2026-10-12T01:00:00.000Z"); // 22:00 em SP
    const decision = evaluateSendPolicy(
      input({ now, dueAt: new Date(now.getTime() - 2 * DAY), counter: { sentCount: 200, countDate: "2026-10-11" } }),
    );
    expect(decision).toEqual({ action: "expire", reason: "expired" });
  });

  it("adiamento que passaria das 24 h expira já", () => {
    // Deveria ter saído ontem às 13:00 (21 h de atraso); teto cheio às 10:00 de hoje: as 8h de
    // amanhã passam das 24 h.
    const dueAt = utc("2026-10-10T16:00:00.000Z");
    const decision = evaluateSendPolicy(input({ dueAt, counter: { sentCount: 200, countDate: "2026-10-11" } }));
    expect(decision).toEqual({ action: "expire", reason: "expired" });
  });

  it("adiamento dentro das 24 h fica adiado", () => {
    const now = utc("2026-10-11T23:30:00.000Z"); // 20:30 em SP
    expect(evaluateSendPolicy(input({ now, dueAt: now }))).toMatchObject({ action: "defer", reason: "outside_window" });
  });
});
