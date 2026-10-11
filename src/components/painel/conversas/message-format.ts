import { DateTime } from "luxon";
import type { ConversationSummaryDto, LastMessageDto, MediaType, MessageDto } from "./conversations-api";

// Textos e horários das telas de conversas (D7). Mídia guarda só o tipo: a tela mostra um rótulo
// entre colchetes, nunca o arquivo. Horários sempre no fuso do negócio, pelo luxon.

const LOCALE = "pt-BR";

const MEDIA_LABEL: Record<MediaType, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  document: "[documento]",
  sticker: "[figurinha]",
  other: "[mídia]",
};

export function mediaLabel(mediaType: MediaType): string {
  return MEDIA_LABEL[mediaType];
}

// Texto corrido de uma mensagem: "[imagem] legenda", "[áudio]" ou só o texto.
export function messageText(message: Pick<MessageDto, "body" | "mediaType">): string {
  const parts = [message.mediaType ? mediaLabel(message.mediaType) : null, message.body?.trim() || null];
  return parts.filter(Boolean).join(" ");
}

// Prévia da última mensagem na lista. Mensagem enviada pelo negócio ganha "Você: ".
export function previewText(last: LastMessageDto | null): string {
  if (!last) return "Sem mensagens";
  const text = messageText(last).replace(/\s+/g, " ");
  return last.direction === "outbound" ? `Você: ${text}` : text;
}

function local(iso: string, timezone: string): DateTime {
  return DateTime.fromISO(iso, { zone: timezone }).setLocale(LOCALE);
}

export function timeOf(iso: string, timezone: string): string {
  return local(iso, timezone).toFormat("HH:mm");
}

// Horário da lista: hoje "14:05", ontem "Ontem", nos últimos 6 dias o dia da semana,
// no mesmo ano "03/10", antes disso "03/10/2025".
export function listTime(iso: string, timezone: string, now: Date = new Date()): string {
  const at = local(iso, timezone);
  const today = DateTime.fromJSDate(now, { zone: timezone }).setLocale(LOCALE).startOf("day");
  const days = Math.round(today.diff(at.startOf("day"), "days").days);
  if (days <= 0) return at.toFormat("HH:mm");
  if (days === 1) return "Ontem";
  if (days < 7) return at.toFormat("cccc").replace("-feira", "");
  return at.year === today.year ? at.toFormat("dd/MM") : at.toFormat("dd/MM/yyyy");
}

// Separador de dia na conversa: "Hoje", "Ontem", "3 de outubro" ou "3 de outubro de 2025".
export function dayLabel(iso: string, timezone: string, now: Date = new Date()): string {
  const at = local(iso, timezone);
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const days = Math.round(today.diff(at.startOf("day"), "days").days);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  return at.year === today.year ? at.toFormat("d 'de' MMMM") : at.toFormat("d 'de' MMMM 'de' yyyy");
}

export function dayKey(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toISODate()!;
}

// Junta páginas e atualizações sem repetir: o item que chegou por último vence.
function mergeById<T extends { id: string }>(current: T[], incoming: T[], compare: (a: T, b: T) => number): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort(compare);
}

// Conversas: mais recente primeiro (sem mensagem por último), como a API ordena.
export function mergeConversations(current: ConversationSummaryDto[], incoming: ConversationSummaryDto[]): ConversationSummaryDto[] {
  return mergeById(current, incoming, (a, b) => {
    if (a.lastMessageAt !== b.lastMessageAt) {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    return b.id.localeCompare(a.id);
  });
}

// Mensagens: em ordem cronológica para ler de cima para baixo (a API manda a mais nova primeiro).
export function mergeMessages(current: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  return mergeById(current, incoming, (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
}
