import { apiRequest, type ApiResult } from "@/components/painel/catalog/api-client";

// Chamadas da tela /painel/whatsapp às rotas da Fase 5 (guia 3, 7a, 7b, 7e). O corpo segue
// whatsappConnectionDto (serializers.ts), com as datas como texto. O QR é sensível: as rotas
// respondem sem cache e a tela nunca o grava nem o loga.

export type ConnectionStatus = "not_configured" | "connected" | "disconnected" | "qr_pending" | "banned_suspected";

export interface PairingQrDto {
  format: "text" | "data_url";
  value: string;
  expiresAt: string;
}

export interface ConnectionDto {
  status: ConnectionStatus;
  lastCheckedAt: string | null;
  qr: PairingQrDto | null;
  // false: o provedor não respondeu e o estado é o último gravado.
  live: boolean;
}

export type ConnectionAction = "connect" | "reconnect" | "disconnect";

const unwrap = async (request: Promise<ApiResult<{ connection: ConnectionDto }>>): Promise<ApiResult<ConnectionDto>> => {
  const result = await request;
  return result.ok ? { ok: true, data: result.data.connection } : result;
};

export function fetchConnection(): Promise<ApiResult<ConnectionDto>> {
  return unwrap(apiRequest("GET", "/api/whatsapp"));
}

export function runConnectionAction(action: ConnectionAction): Promise<ApiResult<ConnectionDto>> {
  return unwrap(apiRequest("POST", `/api/whatsapp/${action}`));
}
