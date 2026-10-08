import { LOGIN_PATH } from "@/server/auth/redirects";

// Chamadas das telas do painel às rotas de profissionais, serviços e horários (Fase 4) e leitura
// do erro padrão (D7). Sessão vencida (401) leva ao login guardando a tela atual em ?next=.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const NETWORK_ERROR = {
  ok: false,
  status: 0,
  code: "network",
  message: "Não foi possível conectar. Verifique a internet e tente de novo.",
} as const;

const UNEXPECTED_MESSAGE = "Algo deu errado do nosso lado. Tente de novo em instantes.";

export async function apiRequest<T = void>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NETWORK_ERROR;
  }

  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    // Navegação completa de propósito (como no "Sair"): descarta o cache do roteador.
    window.location.assign(new URL(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`, window.location.origin));
    return { ok: false, status: 401, code: "unauthorized", message: "Sua sessão terminou. Entre de novo." };
  }

  if (response.ok) {
    if (response.status === 204) return { ok: true, data: undefined as T };
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, status: response.status, code: "unexpected", message: UNEXPECTED_MESSAGE };
    }
  }

  try {
    const { error } = (await response.json()) as { error?: { code?: string; message?: string } };
    if (error?.code && error.message) {
      return { ok: false, status: response.status, code: error.code, message: error.message };
    }
  } catch {
    // corpo fora do padrão: cai na mensagem genérica abaixo
  }
  return { ok: false, status: response.status, code: "unexpected", message: UNEXPECTED_MESSAGE };
}

// Corpos de resposta da API (serializers.ts), com as datas já como texto.
export interface ProfessionalDto {
  id: string;
  name: string;
  archivedAt: string | null;
}

export interface ServiceDto {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  archivedAt: string | null;
}

export interface WorkingHoursDto {
  id: string;
  professionalId: string;
  weekday: number;
  start: string;
  end: string;
}
