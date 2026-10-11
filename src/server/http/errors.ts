import { NextResponse } from "next/server";
import type { ZodError } from "zod";

// Formato único de erro da API (D7): { error: { code, message } }. Quando a entrada tem vários
// problemas que a tela mostra no campo certo (ex.: variações de um template), vem também `issues`.

export interface ApiError {
  error: { code: string; message: string; issues?: unknown[] };
}

export function errorResponse(status: number, code: string, message: string, issues?: unknown[]): NextResponse<ApiError> {
  return NextResponse.json({ error: issues ? { code, message, issues } : { code, message } }, { status });
}

export function validationErrorResponse(error: ZodError, code = "invalid_input"): NextResponse<ApiError> {
  return errorResponse(400, code, error.issues[0]?.message ?? "Dados inválidos.");
}

// Corpo ausente ou JSON quebrado vira objeto vazio e cai na validação do Zod.
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
