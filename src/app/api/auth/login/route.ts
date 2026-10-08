import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { InvalidCredentialsError, login, TooManyAttemptsError } from "@/server/auth/auth-service";
import { clientIp } from "@/server/auth/client-ip";
import { sessionResponse } from "@/server/auth/responses";
import { errorResponse, readJson, validationErrorResponse } from "@/server/http/errors";

// POST /api/auth/login (guia 7b). Erro genérico: não diz se o e-mail existe (premissa e).
export async function POST(request: NextRequest) {
  try {
    return sessionResponse(await login(await readJson(request), clientIp(request.headers)), 200);
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    if (error instanceof InvalidCredentialsError) {
      return errorResponse(401, "invalid_credentials", "E-mail ou senha incorretos.");
    }
    if (error instanceof TooManyAttemptsError) {
      return errorResponse(429, "too_many_attempts", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    }
    throw error;
  }
}
