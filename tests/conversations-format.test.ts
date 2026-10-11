import { describe, expect, it } from "vitest";
import type { ConversationSummaryDto, MessageDto } from "@/components/painel/conversas/conversations-api";
import {
  dayLabel,
  listTime,
  mediaLabel,
  mergeConversations,
  mergeMessages,
  messageText,
  previewText,
  timeOf,
} from "@/components/painel/conversas/message-format";

// Fatia 3 (whatsapp-conexao-mensagens), Fase 7: textos e horários da tela de conversas (D7).
// Mídia só como rótulo; horários no fuso do negócio.

const SP = "America/Sao_Paulo";
// 11/10/2026, 15:00 em São Paulo (UTC-3).
const NOW = new Date("2026-10-11T18:00:00.000Z");

describe("mídia como rótulo (D7)", () => {
  it("imagem e áudio aparecem entre colchetes, sem arquivo", () => {
    expect(mediaLabel("image")).toBe("[imagem]");
    expect(mediaLabel("audio")).toBe("[áudio]");
    expect(mediaLabel("video")).toBe("[vídeo]");
    expect(mediaLabel("document")).toBe("[documento]");
    expect(mediaLabel("sticker")).toBe("[figurinha]");
    expect(mediaLabel("other")).toBe("[mídia]");
  });

  it("texto, mídia sozinha e mídia com legenda", () => {
    expect(messageText({ body: "Oi, tem horário?", mediaType: null })).toBe("Oi, tem horário?");
    expect(messageText({ body: null, mediaType: "audio" })).toBe("[áudio]");
    expect(messageText({ body: " Olha a foto ", mediaType: "image" })).toBe("[imagem] Olha a foto");
  });

  it("prévia da lista: uma linha, 'Você: ' nas enviadas e conversa sem mensagem", () => {
    const sentAt = NOW.toISOString();
    expect(previewText({ direction: "inbound", body: "linha 1\nlinha 2", mediaType: null, sentAt })).toBe("linha 1 linha 2");
    expect(previewText({ direction: "inbound", body: null, mediaType: "image", sentAt })).toBe("[imagem]");
    expect(previewText({ direction: "outbound", body: "Confirmado", mediaType: null, sentAt })).toBe("Você: Confirmado");
    expect(previewText(null)).toBe("Sem mensagens");
  });
});

describe("horários no fuso do negócio", () => {
  it("hora local, não UTC", () => {
    expect(timeOf("2026-10-11T17:05:00.000Z", SP)).toBe("14:05");
    expect(timeOf("2026-10-11T17:05:00.000Z", "Europe/Lisbon")).toBe("18:05");
  });

  it("lista: hoje, ontem, dia da semana, data do ano e de outro ano", () => {
    expect(listTime("2026-10-11T12:30:00.000Z", SP, NOW)).toBe("09:30");
    // 00:30 de hoje em SP ainda é dia 11, mesmo sendo 03:30 UTC.
    expect(listTime("2026-10-11T03:30:00.000Z", SP, NOW)).toBe("00:30");
    // 23:59 de ontem em SP (já é dia 11 em UTC).
    expect(listTime("2026-10-11T02:59:00.000Z", SP, NOW)).toBe("Ontem");
    expect(listTime("2026-10-08T15:00:00.000Z", SP, NOW)).toBe("quinta");
    expect(listTime("2026-10-04T15:00:00.000Z", SP, NOW)).toBe("04/10");
    expect(listTime("2025-12-31T15:00:00.000Z", SP, NOW)).toBe("31/12/2025");
  });

  it("separador de dia da conversa", () => {
    expect(dayLabel("2026-10-11T12:00:00.000Z", SP, NOW)).toBe("Hoje");
    expect(dayLabel("2026-10-10T12:00:00.000Z", SP, NOW)).toBe("Ontem");
    expect(dayLabel("2026-10-03T12:00:00.000Z", SP, NOW)).toBe("3 de outubro");
    expect(dayLabel("2025-03-03T12:00:00.000Z", SP, NOW)).toBe("3 de março de 2025");
  });
});

describe("junção de páginas e atualizações", () => {
  const message = (id: string, sentAt: string, body = id): MessageDto => ({
    id,
    direction: "inbound",
    body,
    mediaType: null,
    status: "received",
    sentAt,
  });

  it("mensagens em ordem cronológica, sem repetir, com a versão mais nova", () => {
    const page1 = [message("c", "2026-10-11T12:02:00.000Z"), message("b", "2026-10-11T12:01:00.000Z")];
    const page2 = [message("b", "2026-10-11T12:01:00.000Z"), message("a", "2026-10-11T12:00:00.000Z")];
    const merged = mergeMessages(mergeMessages([], page1), page2);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    const updated = mergeMessages(merged, [message("c", "2026-10-11T12:02:00.000Z", "editada")]);
    expect(updated).toHaveLength(3);
    expect(updated[2].body).toBe("editada");
  });

  it("conversas: a que recebeu mensagem sobe; sem mensagem vai para o fim", () => {
    const conversation = (id: string, lastMessageAt: string | null): ConversationSummaryDto => ({
      id,
      lastMessageAt,
      contact: { id: `contato-${id}`, name: id, phone: "+5511987654321" },
      lastMessage: null,
    });
    const current = [conversation("a", "2026-10-11T12:00:00.000Z"), conversation("b", "2026-10-11T11:00:00.000Z"), conversation("z", null)];
    const merged = mergeConversations(current, [conversation("b", "2026-10-11T13:00:00.000Z")]);
    expect(merged.map((item) => item.id)).toEqual(["b", "a", "z"]);
  });
});
