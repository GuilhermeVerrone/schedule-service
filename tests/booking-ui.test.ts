import { describe, expect, it } from "vitest";
import { isSlotTaken } from "@/components/site/booking/booking-api";
import {
  dayButton,
  formatDeadline,
  formatLongDate,
  formatWhen,
  isValidEmail,
  isValidPhone,
  lastBookableDay,
  lastPage,
  localDate,
  localTime,
  monthsLabel,
  pageOf,
  todayIn,
  weekDays,
} from "@/components/site/booking/booking-format";

// Fase 9 (agenda-link-publico): datas e validações das telas de agendar e de gestão pelo link
// (guia 6, 7a, 7c; D11). Tudo no fuso do negócio, pelo luxon.

describe("dia de hoje e semanas da escolha de dia", () => {
  it("hoje é o dia no fuso do negócio, não no do navegador", () => {
    const lateNight = new Date("2026-10-11T02:30:00Z"); // 23:30 de 10/10 em São Paulo
    expect(todayIn("America/Sao_Paulo", lateNight)).toBe("2026-10-10");
    expect(todayIn("Asia/Tokyo", lateNight)).toBe("2026-10-11");
  });

  it("cada página tem 7 dias a partir de hoje, atravessando o mês", () => {
    expect(weekDays("2026-10-28", 0)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(weekDays("2026-10-28", 1)[0]).toBe("2026-11-04");
  });

  it("a janela máxima define o último dia e a última página", () => {
    expect(lastBookableDay("2026-10-10", 60)).toBe("2026-12-09");
    expect(lastPage("2026-10-10", 60)).toBe(8); // 60 dias depois cai na 9ª semana (página 8)
    expect(lastPage("2026-10-10", 6)).toBe(0);
    expect(lastPage("2026-10-10", 7)).toBe(1);
  });

  it("acha a página de um dia e nunca devolve página negativa", () => {
    expect(pageOf("2026-10-10", "2026-10-10")).toBe(0);
    expect(pageOf("2026-10-10", "2026-10-16")).toBe(0);
    expect(pageOf("2026-10-10", "2026-10-17")).toBe(1);
    expect(pageOf("2026-10-10", "2026-10-01")).toBe(0);
  });

  it("rótulos de dia e de mês em português", () => {
    expect(dayButton("2026-10-10")).toEqual({ weekday: "Sáb", day: "10", long: "Sábado, 10 de outubro" });
    expect(monthsLabel(weekDays("2026-10-10", 0))).toBe("Outubro de 2026");
    expect(monthsLabel(weekDays("2026-10-28", 0))).toBe("Outubro e novembro de 2026");
    expect(monthsLabel(weekDays("2026-12-28", 0))).toBe("Dezembro de 2026 e janeiro de 2027");
  });
});

describe("horários no fuso do negócio", () => {
  it("instante UTC vira dia e hora locais, inclusive na virada do dia", () => {
    expect(localTime("2026-10-20T13:00:00.000Z", "America/Sao_Paulo")).toBe("10:00");
    expect(localDate("2026-10-21T01:30:00.000Z", "America/Sao_Paulo")).toBe("2026-10-20");
    expect(localTime("2026-10-21T01:30:00.000Z", "America/Sao_Paulo")).toBe("22:30");
  });

  it("respeita o horário de verão de um fuso que o tem", () => {
    // Nova York: UTC-4 em outubro, UTC-5 depois de 1º de novembro de 2026.
    expect(localTime("2026-10-30T14:00:00.000Z", "America/New_York")).toBe("10:00");
    expect(localTime("2026-11-02T14:00:00.000Z", "America/New_York")).toBe("09:00");
  });

  it("formata a data longa, o intervalo e o prazo", () => {
    expect(formatLongDate("2026-10-20T13:00:00.000Z", "America/Sao_Paulo")).toBe("Terça-feira, 20 de outubro de 2026");
    expect(formatWhen("2026-10-20T13:00:00.000Z", "2026-10-20T13:45:00.000Z", "America/Sao_Paulo")).toBe(
      "Terça-feira, 20 de outubro de 2026, das 10:00 às 10:45",
    );
    expect(formatDeadline("2026-10-20T11:00:00.000Z", "America/Sao_Paulo")).toBe("20/10/2026 às 08:00");
  });
});

describe("dados do cliente", () => {
  it("telefone com DDD, com ou sem máscara e DDI 55", () => {
    expect(isValidPhone("(11) 98765-4321")).toBe(true);
    expect(isValidPhone("11 3456-7890")).toBe(true);
    expect(isValidPhone("+55 11 98765-4321")).toBe(true);
    expect(isValidPhone("98765-4321")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("abc")).toBe(false);
  });

  it("e-mail simples", () => {
    expect(isValidEmail("ana@exemplo.com")).toBe(true);
    expect(isValidEmail(" ana@exemplo.com ")).toBe(true);
    expect(isValidEmail("ana@exemplo")).toBe(false);
    expect(isValidEmail("ana exemplo.com")).toBe(false);
  });
});

describe("erro de horário tomado (409, D8)", () => {
  it("só slot_unavailable recarrega os horários", () => {
    expect(isSlotTaken({ code: "slot_unavailable" })).toBe(true);
    expect(isSlotTaken({ code: "deadline_passed" })).toBe(false);
    expect(isSlotTaken({ code: "invalid_input" })).toBe(false);
  });
});
