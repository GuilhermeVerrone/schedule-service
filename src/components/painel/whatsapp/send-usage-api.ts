import { apiRequest, type ApiResult } from "@/components/painel/catalog/api-client";

// Chamadas do bloco de uso e bloqueios de /painel/whatsapp (guia 3, 7f; D6) às rotas da Fase 9.
// O corpo segue sendUsageDto e blockedMessageDto (serializers.ts), com as datas como texto.

export interface SendUsageDto {
  configured: boolean;
  day: string;
  timezone: string;
  used: number;
  limit: number;
  manualLimit: number | null;
  warmup: {
    startedAt: string | null;
    day: number;
    totalDays: number;
    inWarmup: boolean;
    curveLimit: number;
    matureLimit: number;
    next: { day: number; limit: number } | null;
  };
}

export interface BlockedMessageDto {
  id: string;
  messageType: string;
  channel: string | null;
  // Código do motivo (ex.: opt_out); a tela traduz em block-reasons.ts.
  reason: string | null;
  scheduledFor: string;
  createdAt: string;
  blockedAt: string;
  contact: { id: string; name: string; phone: string };
}

export interface BlockedPageDto {
  items: BlockedMessageDto[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export async function fetchSendUsage(): Promise<ApiResult<SendUsageDto>> {
  const result = await apiRequest<{ usage: SendUsageDto }>("GET", "/api/whatsapp/usage");
  return result.ok ? { ok: true, data: result.data.usage } : result;
}

export async function fetchBlocked(page: number): Promise<ApiResult<BlockedPageDto>> {
  const result = await apiRequest<{ blocked: BlockedPageDto }>("GET", `/api/whatsapp/blocked?page=${page}`);
  return result.ok ? { ok: true, data: result.data.blocked } : result;
}
