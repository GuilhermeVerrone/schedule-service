import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockReasonLabel, channelLabel, messageTypeLabel } from "@/components/painel/whatsapp/block-reasons";
import { OUTBOUND_MESSAGE_TYPES } from "@/server/outbound/message-types";

// Fase 10 (D6): a tela traduz os códigos crus da API. Todo motivo que o worker grava tem texto
// próprio, e código desconhecido nunca aparece cru.

const GENERIC = "Bloqueado pelas regras de envio.";

// Motivos que chegam a `block_reason`: os da elegibilidade, do conteúdo e os literais do worker.
function reasonsInCode(): string[] {
  const sources = ["src/server/outbound/eligibility.ts", "src/server/outbound/content.ts", "src/server/outbound/worker.ts"];
  const found = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/reason: "([a-z_]+)"/g)) found.add(match[1]);
    for (const match of text.matchAll(/markBlocked\([^,]+, "([a-z_]+)"\)/g)) found.add(match[1]);
    for (const match of text.matchAll(/Reason = ((?:"[a-z_]+"\s*\|?\s*)+)/g)) {
      for (const literal of match[1].matchAll(/"([a-z_]+)"/g)) found.add(literal[1]);
    }
  }
  // Motivos de envio liberado, adiado ou descartado não viram bloqueio.
  for (const ok of ["recent_inbound", "active_commitment", "registered_consent", "expired", "invalid_tenant", "unknown_message"]) {
    found.delete(ok);
  }
  return [...found];
}

describe("textos do bloco de bloqueios", () => {
  it("todo motivo de bloqueio do código tem texto próprio", () => {
    const reasons = reasonsInCode();
    expect(reasons).toEqual(expect.arrayContaining(["opt_out", "not_eligible", "no_channel", "template_inactive", "contact_not_found"]));
    for (const reason of reasons) expect(blockReasonLabel(reason), reason).not.toBe(GENERIC);
  });

  it("motivo desconhecido ou nulo cai no texto genérico, nunca no código", () => {
    expect(blockReasonLabel("motivo_novo")).toBe(GENERIC);
    expect(blockReasonLabel(null)).toBe(GENERIC);
  });

  it("todo tipo da lista fechada tem nome, e tipo desconhecido tem nome genérico", () => {
    for (const type of OUTBOUND_MESSAGE_TYPES) expect(messageTypeLabel(type)).not.toBe("Mensagem do sistema");
    expect(messageTypeLabel("campanha")).toBe("Mensagem do sistema");
  });

  it("canais", () => {
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
    expect(channelLabel("email")).toBe("E-mail");
    expect(channelLabel(null)).toBeNull();
    expect(channelLabel("sms")).toBeNull();
  });

  it("textos sem travessão (DESIGN.md)", () => {
    const all = [...reasonsInCode().map(blockReasonLabel), ...OUTBOUND_MESSAGE_TYPES.map(messageTypeLabel)];
    for (const text of all) expect(text).not.toMatch(/[–—]/);
  });
});
