import { describe, expect, it } from "vitest";
import { formatPhone, isNormalizedPhone, normalizePhone } from "@/lib/phone";
import { appointmentCreateSchema } from "@/server/validation/agenda-api";
import { normalizedPhoneSchema } from "@/server/validation/agenda";
import { publicBookingSchema } from "@/server/validation/public-api";
import { isValidPhone } from "@/components/site/booking/booking-format";

// Telefone em E.164 (Fatia 3, D2 e D11): uma função só para o painel, o link público e o WhatsApp.
describe("normalizePhone", () => {
  it("sem DDI, 10 ou 11 dígitos são do Brasil e ganham o 55", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("11987654321")).toBe("+5511987654321");
    expect(normalizePhone("11 3456-7890")).toBe("+551134567890");
    expect(normalizePhone("  (21) 3456.7890 ")).toBe("+552134567890");
  });

  it("com DDI 55, com ou sem o +, e no formato que o banco já guarda", () => {
    expect(normalizePhone("+55 11 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("+55 (11) 3456-7890")).toBe("+551134567890");
    expect(normalizePhone("5511987654321")).toBe("+5511987654321");
    expect(normalizePhone("+5511987654321")).toBe("+5511987654321");
  });

  it("aceita número internacional em E.164 válido", () => {
    expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+351 912 345 678")).toBe("+351912345678");
    // Sem "+", 12 a 15 dígitos já trazem o DDI (como o WhatsApp identifica o número).
    expect(normalizePhone("442079460958")).toBe("+442079460958");
    expect(normalizePhone("351912345678")).toBe("+351912345678");
    // Sem "+", 10 ou 11 dígitos são sempre lidos como Brasil: "14155552671" seria DDD 14 com
    // 9 dígitos sem o 9 na frente, e é recusado. Número de fora com 10 ou 11 dígitos exige o "+".
    expect(normalizePhone("14155552671")).toBeNull();
    // Limites do E.164: 10 e 15 dígitos.
    expect(normalizePhone("+1234567890")).toBe("+1234567890");
    expect(normalizePhone("+123456789012345")).toBe("+123456789012345");
  });

  it("nono dígito do Brasil: com 9 dígitos o número começa com 9; com 8, é fixo ou celular antigo", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("+55 11 98765-4321")).toBe("+5511987654321");
    // 9 dígitos sem começar com 9 não existe no Brasil.
    expect(normalizePhone("(11) 88765-4321")).toBeNull();
    expect(normalizePhone("+55 11 18765-4321")).toBeNull();
    // 8 dígitos: fixo (2 a 5) ou celular ainda sem o nono dígito (6 a 9), como o WhatsApp manda.
    expect(normalizePhone("(11) 3456-7890")).toBe("+551134567890");
    expect(normalizePhone("+55 11 8765-4321")).toBe("+551187654321");
    // O nono dígito nunca é inventado: são números diferentes.
    expect(normalizePhone("11 8765-4321")).not.toBe(normalizePhone("11 98765-4321"));
    // Número local não começa com 0 ou 1.
    expect(normalizePhone("(11) 0456-7890")).toBeNull();
    expect(normalizePhone("(11) 1456-7890")).toBeNull();
  });

  it("recusa entradas inválidas", () => {
    for (const value of [
      "",
      "   ",
      "123",
      "abc",
      "11 98765-4321 ramal 2",
      "+55 11 98765-4321a",
      "(11) 9876-54321x",
      "+",
      "++5511987654321",
      "+55+11987654321",
      "+5511987654321+",
      "+0 11 98765 4321",
      "+123456789",
      "+1234567890123456",
      "1234567890123456",
      "123456789",
      "011987654321",
      "+55 01 98765-4321",
      "+55 10 98765-4321",
      "+55 11 987654-4321",
      "+55 11 8765-432",
      "55119876543210",
    ]) {
      expect(normalizePhone(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("é idempotente e isNormalizedPhone só aceita a forma do banco", () => {
    for (const value of ["(11) 98765-4321", "+1 415 555 2671", "11 3456-7890"]) {
      const once = normalizePhone(value)!;
      expect(normalizePhone(once)).toBe(once);
      expect(isNormalizedPhone(once)).toBe(true);
    }
    for (const value of ["5511987654321", "11987654321", "+55 11 98765-4321", "+5511887654321"]) {
      expect(isNormalizedPhone(value)).toBe(false);
    }
  });
});

describe("telefone nas entradas da API e da tela", () => {
  const base = { professionalId: "p", serviceId: "s", startsAt: "2026-10-20T13:00:00Z" };

  it("agendamento manual e público normalizam para E.164 pela mesma função", () => {
    const manual = appointmentCreateSchema.parse({ ...base, contact: { name: "Ana", phone: "(11) 98765-4321" } });
    expect(manual.contact.phone).toBe("+5511987654321");
    const pub = publicBookingSchema.parse({
      serviceId: "s",
      startsAt: base.startsAt,
      contact: { name: "Ana", phone: "+1 415 555 2671" },
      consent: true,
    });
    expect(pub.contact.phone).toBe("+14155552671");
  });

  it("telefone inválido vira erro de validação, não chega ao banco", () => {
    const manual = appointmentCreateSchema.safeParse({ ...base, contact: { name: "Ana", phone: "(11) 88765-4321" } });
    expect(manual.success).toBe(false);
    expect(normalizedPhoneSchema.safeParse("5511987654321").success).toBe(false);
    expect(normalizedPhoneSchema.safeParse("+5511987654321").success).toBe(true);
  });

  it("a tela pública usa a mesma regra", () => {
    expect(isValidPhone("(13) 98888-1234")).toBe(true);
    expect(isValidPhone("+44 20 7946 0958")).toBe(true);
    expect(isValidPhone("(13) 8888-123")).toBe(false);
  });

  it("formata para exibição: Brasil com máscara, internacional em E.164", () => {
    expect(formatPhone("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("+551134567890")).toBe("(11) 3456-7890");
    expect(formatPhone("+14155552671")).toBe("+14155552671");
  });
});
