import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, formatDuration, parseBrlToCents } from "@/components/painel/catalog/money";

describe("parseBrlToCents (preço digitado → centavos inteiros)", () => {
  it.each([
    ["50", 5000],
    ["50,5", 5050],
    ["49,90", 4990],
    ["0", 0],
    ["0,05", 5],
    ["1.234,56", 123456],
    ["1.000.000", 100000000],
    ["R$ 80", 8000],
    ["r$80,00", 8000],
    ["  35,00 ", 3500],
    ["49.90", 4990],
    ["49.9", 4990],
    ["1.234", 123400],
    ["0,10", 10],
    ["19,99", 1999],
  ])("%j → %i", (input, cents) => {
    expect(parseBrlToCents(input)).toBe(cents);
  });

  it.each(["", "   ", "abc", "-5", "5,123", "1,2,3", "12.34.56", "1.23,45", ",50", "5,", "1e3", "50 reais"])(
    "%j é recusado",
    (input) => {
      expect(parseBrlToCents(input)).toBeNull();
    },
  );

  it("nunca produz float (0,10 + 0,20 continua exato)", () => {
    expect(parseBrlToCents("0,10")! + parseBrlToCents("0,20")!).toBe(30);
  });
});

describe("formatação", () => {
  it("centavos em reais, com espaço comum depois de R$", () => {
    expect(formatCents(4990)).toBe("R$ 49,90");
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(123456)).toBe("R$ 1.234,56");
  });

  it("valor do campo de edição volta ao mesmo número", () => {
    for (const cents of [0, 5, 4990, 123456, 100000000]) {
      expect(parseBrlToCents(centsToInput(cents))).toBe(cents);
    }
  });

  it.each([
    [5, "5 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [480, "8 h"],
  ])("duração %i → %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});
