// Chamadas do site público às rotas /api/public/{slug}/... (Fase 5) e leitura do erro padrão
// (D7). Sem sessão: o tenant vem só do slug. O token de gestão só passa pela URL da própria API.

export type PublicResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

const NETWORK_ERROR = {
  ok: false,
  status: 0,
  code: "network",
  message: "Não foi possível conectar. Verifique a internet e tente de novo.",
} as const;

const UNEXPECTED_MESSAGE = "Algo deu errado do nosso lado. Tente de novo em instantes.";

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<PublicResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return NETWORK_ERROR;
  }
  if (response.ok) {
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, status: response.status, code: "unexpected", message: UNEXPECTED_MESSAGE };
    }
  }
  try {
    const { error } = (await response.json()) as { error?: { code?: string; message?: string } };
    if (error?.code && error.message) return { ok: false, status: response.status, code: error.code, message: error.message };
  } catch {
    // corpo fora do padrão: cai na mensagem genérica abaixo
  }
  return { ok: false, status: response.status, code: "unexpected", message: UNEXPECTED_MESSAGE };
}

export interface PublicSlot {
  startsAt: string;
  professionalIds: string[];
}

export type AppointmentStatus = "confirmed" | "canceled" | "completed";

export interface PublicAppointment {
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  canceledAt: string | null;
  service: { id: string; name: string; durationMinutes: number; priceCents: number };
  professional: { id: string; name: string };
  contact: { name: string };
  manageableUntil: string;
  canManage: boolean;
}

export interface BookingInput {
  serviceId: string;
  professionalId: string | null;
  startsAt: string;
  contact: { name: string; phone: string; email: string | null };
  consent: true;
}

export interface BookingCreated {
  appointment: PublicAppointment;
  managePath: string;
}

const base = (slug: string) => `/api/public/${encodeURIComponent(slug)}`;
const tokenPath = (slug: string, token: string) => `${base(slug)}/appointments/${encodeURIComponent(token)}`;

export async function loadDaySlots(
  slug: string,
  query: { serviceId: string; date: string; professionalId: string | null },
): Promise<PublicResult<PublicSlot[]>> {
  const params = new URLSearchParams({ serviceId: query.serviceId, date: query.date });
  if (query.professionalId) params.set("professionalId", query.professionalId);
  const result = await request<{ slots: PublicSlot[] }>("GET", `${base(slug)}/availability?${params}`);
  return result.ok ? { ok: true, data: result.data.slots } : result;
}

export function createBooking(slug: string, input: BookingInput): Promise<PublicResult<BookingCreated>> {
  return request<BookingCreated>("POST", `${base(slug)}/appointments`, input);
}

export async function loadAppointment(slug: string, token: string): Promise<PublicResult<PublicAppointment>> {
  const result = await request<{ appointment: PublicAppointment }>("GET", tokenPath(slug, token));
  return result.ok ? { ok: true, data: result.data.appointment } : result;
}

export async function cancelAppointment(slug: string, token: string): Promise<PublicResult<PublicAppointment>> {
  const result = await request<{ appointment: PublicAppointment }>("POST", `${tokenPath(slug, token)}/cancel`);
  return result.ok ? { ok: true, data: result.data.appointment } : result;
}

export async function rescheduleAppointment(
  slug: string,
  token: string,
  input: { startsAt: string; professionalId: string },
): Promise<PublicResult<PublicAppointment>> {
  const result = await request<{ appointment: PublicAppointment }>("POST", `${tokenPath(slug, token)}/reschedule`, input);
  return result.ok ? { ok: true, data: result.data.appointment } : result;
}

// O horário escolhido deixou de estar livre (D8): a tela recarrega os horários do dia.
export const isSlotTaken = (result: { code: string }) => result.code === "slot_unavailable";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confirmado",
  canceled: "Cancelado",
  completed: "Concluído",
};
