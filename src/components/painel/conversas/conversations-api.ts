import { apiRequest, type ApiResult } from "@/components/painel/catalog/api-client";

// Chamadas das telas /painel/conversas às rotas da Fase 5 (guia 7d; D6, D7). Somente leitura:
// nenhuma chamada aqui grava ou envia mensagem. Os corpos seguem conversationSummaryDto,
// conversationDto e messageDto (serializers.ts), com as datas como texto.

export type MediaType = "image" | "audio" | "video" | "document" | "sticker" | "other";
export type MessageDirection = "inbound" | "outbound";

export interface ContactDto {
  id: string;
  name: string;
  phone: string;
}

export interface LastMessageDto {
  direction: MessageDirection;
  body: string | null;
  mediaType: MediaType | null;
  sentAt: string;
}

export interface ConversationSummaryDto {
  id: string;
  lastMessageAt: string | null;
  contact: ContactDto;
  lastMessage: LastMessageDto | null;
}

export interface ConversationDto {
  id: string;
  lastMessageAt: string | null;
  createdAt: string;
  contact: ContactDto;
}

export interface MessageDto {
  id: string;
  direction: MessageDirection;
  body: string | null;
  mediaType: MediaType | null;
  status: string;
  sentAt: string;
}

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function fetchConversations(page = 1): Promise<ApiResult<{ conversations: PageDto<ConversationSummaryDto> }>> {
  return apiRequest("GET", `/api/conversations?page=${page}`);
}

export function fetchMessages(
  conversationId: string,
  page = 1,
): Promise<ApiResult<{ conversation: ConversationDto; messages: PageDto<MessageDto> }>> {
  return apiRequest("GET", `/api/conversations/${encodeURIComponent(conversationId)}/messages?page=${page}`);
}

// Fuso do negócio (D11 da Fatia 2): os horários das mensagens seguem o da agenda.
export async function fetchTimezone(): Promise<ApiResult<string>> {
  const result = await apiRequest<{ settings: { timezone: string } }>("GET", "/api/settings");
  return result.ok ? { ok: true, data: result.data.settings.timezone } : result;
}
