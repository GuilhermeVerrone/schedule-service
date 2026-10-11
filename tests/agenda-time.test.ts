import { describe, expect, it } from "vitest";
import {
  dayParts,
  formatDayTitle,
  formatWeekTitle,
  localDate,
  localTime,
  rangeOf,
  shiftDate,
  toInstant,
  todayIn,
  weekStart,
} from "@/components/painel/agenda/agenda-time";
import { conflictMessage, formatPhone } from "@/components/painel/agenda/agenda-data";

// Datas da tela /painel/agenda (Fase 7; D9, D11): dia e semana no fuso do negócio, intervalos em
// UTC para a API e conversão de dia + hora digitados, inclusive no horário de verão.
describe("datas da agenda do painel", () => {
  it("o dia de hoje é o do fuso do negócio, não o do navegador", () => {
    const lateNightUtc = new Date("2026-10-11T02:30:00Z"); // 23:30 do dia 10 em São Paulo
    expect(todayIn("America/Sao_Paulo", lateNightUtc)).toBe("2026-10-10");
    expect(todayIn("Asia/Tokyo", lateNightUtc)).toBe("2026-10-11");
  });

  it("dia: intervalo [00:00, 24:00) local em UTC", () => {
    expect(rangeOf("day", "2026-10-10", "America/Sao_Paulo")).toEqual({
      days: ["2026-10-10"],
      from: "2026-10-10T03:00:00.000Z",
      to: "2026-10-11T03:00:00.000Z",
    });
  });

  it("semana: de segunda a domingo, a partir de qualquer dia dela", () => {
    expect(weekStart("2026-10-10")).toBe("2026-10-05"); // sábado → segunda
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // domingo ainda é da mesma semana
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    const week = rangeOf("week", "2026-10-10", "America/Sao_Paulo");
    expect(week.days).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(week.from).toBe("2026-10-05T03:00:00.000Z");
    expect(week.to).toBe("2026-10-12T03:00:00.000Z");
  });

  it("semana com horário de verão (Nova York): o fim é a meia-noite local, não 7 × 24 h", () => {
    // 2026-11-01: fim do horário de verão nos EUA (UTC-4 → UTC-5).
    const week = rangeOf("week", "2026-10-28", "America/New_York");
    expect(week.from).toBe("2026-10-26T04:00:00.000Z");
    expect(week.to).toBe("2026-11-02T05:00:00.000Z");
  });

  it("anterior e próximo andam um dia ou uma semana, virando mês e ano", () => {
    expect(shiftDate("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("day", "2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDate("week", "2026-12-28", 1)).toBe("2027-01-04");
  });

  it("dia + hora local viram instante UTC; hora inexistente no salto do verão vira null", () => {
    expect(toInstant("2026-10-20", "09:00", "America/Sao_Paulo")).toBe("2026-10-20T12:00:00.000Z");
    expect(toInstant("2026-03-08", "02:30", "America/New_York")).toBeNull();
    expect(toInstant("2026-03-08", "03:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(toInstant("2026-10-20", "", "America/Sao_Paulo")).toBeNull();
    expect(toInstant("20/10/2026", "09:00", "America/Sao_Paulo")).toBeNull();
  });

  it("instante UTC volta para dia e hora do negócio (virada de dia)", () => {
    expect(localDate("2026-10-11T02:30:00Z", "America/Sao_Paulo")).toBe("2026-10-10");
    expect(localTime("2026-10-11T02:30:00Z", "America/Sao_Paulo")).toBe("23:30");
  });

  it("títulos em português, com o ano só quando muda", () => {
    expect(formatDayTitle("2026-10-10", "2026-10-10")).toBe("Sábado, 10 de outubro");
    expect(formatDayTitle("2027-01-04", "2026-10-10")).toBe("Segunda-feira, 4 de janeiro de 2027");
    expect(formatWeekTitle(rangeOf("week", "2026-10-07", "UTC").days)).toBe("5 a 11 de outubro");
    expect(formatWeekTitle(rangeOf("week", "2026-10-01", "UTC").days)).toBe("28 de setembro a 4 de outubro");
    expect(formatWeekTitle(rangeOf("week", "2026-12-30", "UTC").days)).toBe("28 de dezembro de 2026 a 3 de janeiro de 2027");
    expect(dayParts("2026-10-05")).toEqual({ weekday: "Seg", day: "5", long: "Segunda-feira, 5 de outubro" });
  });

  it("telefone e conflito em linguagem do dono", () => {
    expect(formatPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("551132654321")).toBe("(11) 3265-4321");
    expect(conflictMessage("appointment_conflict", "x", "Ana")).toMatch(/^Conflito de horário: Ana já tem um agendamento/);
    expect(conflictMessage("slot_unavailable", "x", "Ana")).toMatch(/não está livre para Ana/);
    expect(conflictMessage("not_bookable", "Esse serviço está arquivado.")).toBe("Esse serviço está arquivado.");
  });
});
