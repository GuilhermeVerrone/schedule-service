import { NextResponse } from "next/server";
import type { Profile } from "@/server/repositories/auth-repository";
import { errorResponse } from "@/server/http/errors";
import type { AuthResult } from "./auth-service";
import { clearSessionCookie, setSessionCookie } from "./session";

// Respostas das rotas /api/auth/*. O token só sai no Set-Cookie, nunca no corpo.

export function profileBody({ user, tenant }: Profile) {
  return { user, tenant };
}

export function sessionResponse(result: AuthResult, status: number): NextResponse {
  const response = NextResponse.json(profileBody(result), { status });
  setSessionCookie(response, result.session.token, result.session.expiresAt);
  return response;
}

export function unauthorizedResponse(): NextResponse {
  const response = errorResponse(401, "unauthorized", "Sessão inválida ou expirada. Entre novamente.");
  clearSessionCookie(response);
  return response;
}
