import { describe, expect, it } from "vitest";
import { formatMinutes, splitMinutes, toMinutes } from "@/components/painel/settings/duration";

// Conversão dos tempos da tela de configurações (D3): gravado em minutos, editado em minutos,
// horas ou dias.
describe("tempos da agenda na tela de configurações", () => {
  it("abre cada valor na maior unidade que o divide sem sobra", () => {
    expect(splitMinutes(120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitMinutes(2880)).toEqual({ amount: 2, unit: "days" });
    expect(splitMinutes(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(splitMinutes(0)).toEqual({ amount: 0, unit: "minutes" });
    expect(splitMinutes(43_200)).toEqual({ amount: 30, unit: "days" });
  });

  it("converte o texto digitado em minutos inteiros", () => {
    expect(toMinutes("2", "hours")).toBe(120);
    expect(toMinutes(" 3 ", "days")).toBe(4320);
    expect(toMinutes("1,5", "hours")).toBe(90);
    expect(toMinutes("45", "minutes")).toBe(45);
    expect(toMinutes("1,1", "hours")).toBe(66);
    expect(toMinutes("0", "hours")).toBe(0);
  });

  it("recusa vazio, negativo, texto e fração que não fecha em minuto", () => {
    expect(toMinutes("", "hours")).toBeNull();
    expect(toMinutes("-1", "hours")).toBeNull();
    expect(toMinutes("duas", "hours")).toBeNull();
    expect(toMinutes("1.5", "minutes")).toBeNull();
    expect(toMinutes("0,01", "hours")).toBeNull();
  });

  it("formata para as dicas no singular e no plural", () => {
    expect(formatMinutes(120)).toBe("2 horas");
    expect(formatMinutes(60)).toBe("1 hora");
    expect(formatMinutes(1440)).toBe("1 dia");
    expect(formatMinutes(45)).toBe("45 minutos");
    expect(formatMinutes(0)).toBe("0 minutos");
  });
});
