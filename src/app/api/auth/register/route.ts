import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { EmailInUseError, register } from "@/server/auth/auth-service";
import { sessionResponse } from "@/server/auth/responses";
import { errorResponse, readJson, validationErrorResponse } from "@/server/http/errors";

// POST /api/auth/register: cria tenant + dono e já devolve a sessão (guia 7a).
export async function POST(request: NextRequest) {
  try {
    return sessionResponse(await register(await readJson(request)), 201);
  } catch (error) {
    if (error instanceof ZodError) {
      const weak = error.issues.some((issue) => issue.path[0] === "password" && issue.code === "too_small");
      return validationErrorResponse(error, weak ? "weak_password" : "invalid_input");
    }
    if (error instanceof EmailInUseError) {
      return errorResponse(409, "email_in_use", "Este e-mail já tem conta. Entre ou use outro e-mail.");
    }
    throw error;
  }
}
