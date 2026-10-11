import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { NotBookableError, SlotUnavailableError } from "@/server/agenda/booking";
import { DeadlinePassedError } from "@/server/agenda/public-booking";
import { errorResponse, validationErrorResponse } from "@/server/http/errors";
import { allowPublicRequest, retryAfterSeconds, type PublicRateLimit } from "@/server/http/rate-limit";
import { NotFoundError } from "@/server/http/tenant-route";
import { createPublicRepository, type ResolvedTenant } from "@/server/repositories/public-repository";
import {
  AppointmentConflictError,
  AppointmentStatusError,
  createTenantRepository,
  type TenantRepository,
} from "@/server/repositories/tenant-repository";

// Base das rotas públicas /api/public/{slug}/... (guia 6, 7f; D1, D6, D8). Sem sessão: o tenant
// vem só do slug da URL, resolvido pelo repositório público. Nenhum tenantId do cliente (corpo,
// consulta ou cabeçalho) é lido aqui. Ordem: limite por IP, slug, handler. Toda resposta sai com
// cabeçalhos que impedem cache e Referer, para o token de gestão não vazar.

export const PUBLIC_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;

export const PUBLIC_NOT_FOUND = {
  business: "Negócio não encontrado.",
  link: "Serviço ou profissional não encontrado.",
  appointment: "Agendamento não encontrado.",
} as const;

const STATUS_LABEL = { confirmed: "confirmado", canceled: "cancelado", completed: "concluído" } as const;

interface PublicRouteContext<P> {
  request: NextRequest;
  tenant: ResolvedTenant;
  repo: TenantRepository;
  params: P;
}

type Handler<P> = (context: PublicRouteContext<P>) => Promise<Response>;

function withPublicHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(PUBLIC_RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) return validationErrorResponse(error);
  if (error instanceof NotFoundError) return errorResponse(404, "not_found", error.resourceMessage);
  // Arquivado ou sem vínculo não aparece no site: para o cliente, é como se não existisse.
  if (error instanceof NotBookableError) return errorResponse(404, "not_found", PUBLIC_NOT_FOUND.link);
  // Conflitos (D8): a tela recarrega os horários e mostra o erro.
  if (error instanceof AppointmentConflictError || error instanceof SlotUnavailableError) {
    return errorResponse(409, "slot_unavailable", "Esse horário acabou de ficar indisponível. Escolha outro.");
  }
  if (error instanceof DeadlinePassedError) {
    return errorResponse(409, "deadline_passed", "O prazo para cancelar ou remarcar pelo link já passou. Fale com o negócio.");
  }
  if (error instanceof AppointmentStatusError) {
    return errorResponse(409, "invalid_status", `Esse agendamento já está ${STATUS_LABEL[error.status]}.`);
  }
  throw error;
}

export function publicRoute<P extends { slug: string }>(limit: PublicRateLimit, handler: Handler<P>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    if (!(await allowPublicRequest(limit, request.headers))) {
      const response = errorResponse(429, "rate_limited", "Muitas requisições. Tente de novo em alguns minutos.");
      response.headers.set("Retry-After", String(retryAfterSeconds(limit)));
      return withPublicHeaders(response);
    }
    try {
      const params = await context.params;
      const tenant = await createPublicRepository().resolveTenant(params.slug);
      if (!tenant) throw new NotFoundError(PUBLIC_NOT_FOUND.business);
      return withPublicHeaders(
        await handler({ request, tenant, repo: createTenantRepository(tenant.tenantId), params }),
      );
    } catch (error) {
      return withPublicHeaders(toErrorResponse(error));
    }
  };
}
