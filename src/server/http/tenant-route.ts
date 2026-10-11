import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { getAuthContext } from "@/server/auth/context";
import { unauthorizedResponse } from "@/server/auth/responses";
import { errorResponse, readJson, validationErrorResponse } from "@/server/http/errors";
import { NotBookableError, SlotUnavailableError } from "@/server/agenda/booking";
import {
  AppointmentConflictError,
  AppointmentStatusError,
  createTenantRepository,
  WorkingHoursOverlapError,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";

// Base das rotas de negócio (guia 6, 7d): o tenantId vem só do contexto injetado pelo proxy e
// vira o repositório. IDs de outro tenant se comportam como inexistentes (404), igual a IDs que
// não existem, sem revelar nada. Erros saem no formato padrão (D7).

export class NotFoundError extends Error {
  constructor(readonly resourceMessage: string) {
    super(resourceMessage);
    this.name = "NotFoundError";
  }
}

export const NOT_FOUND = {
  professional: "Profissional não encontrado.",
  service: "Serviço não encontrado.",
  workingHours: "Horário não encontrado.",
  link: "Profissional ou serviço não encontrado.",
  appointment: "Agendamento não encontrado.",
  timeBlock: "Bloqueio não encontrado.",
} as const;

const STATUS_LABEL = { confirmed: "confirmado", canceled: "cancelado", completed: "concluído" } as const;

export function found<T>(value: T | null | false, message: string): T {
  if (value === null || value === false) throw new NotFoundError(message);
  return value;
}

export async function parseBody<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.output<S>> {
  return schema.parse(await readJson(request));
}

export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.output<S> {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}

interface TenantRouteContext<P> {
  request: NextRequest;
  repo: TenantRepository;
  params: P;
}

type Handler<P> = (context: TenantRouteContext<P>) => Promise<Response>;

export function tenantRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: NextRequest, context?: { params: Promise<P> }): Promise<Response> => {
    const auth = getAuthContext(request.headers);
    if (!auth) return unauthorizedResponse();
    try {
      const params = (await context?.params) ?? ({} as P);
      return await handler({ request, repo: createTenantRepository(auth.tenantId), params });
    } catch (error) {
      if (error instanceof ZodError) return validationErrorResponse(error);
      if (error instanceof NotFoundError) return errorResponse(404, "not_found", error.resourceMessage);
      if (error instanceof WorkingHoursOverlapError) {
        return errorResponse(409, "working_hours_overlap", "Esse horário se sobrepõe a outro no mesmo dia.");
      }
      // Conflitos da agenda (D8): a tela recarrega os horários e mostra o erro.
      if (error instanceof AppointmentConflictError) {
        return errorResponse(409, "appointment_conflict", "O profissional já tem agendamento nesse horário.");
      }
      if (error instanceof SlotUnavailableError) {
        return errorResponse(409, "slot_unavailable", "Esse horário não está disponível na agenda.");
      }
      if (error instanceof AppointmentStatusError) {
        return errorResponse(409, "invalid_status", `Esse agendamento já está ${STATUS_LABEL[error.status]}.`);
      }
      if (error instanceof NotBookableError) return errorResponse(422, "not_bookable", error.message);
      throw error;
    }
  };
}

export function noContent(): Response {
  return new NextResponse(null, { status: 204 });
}
