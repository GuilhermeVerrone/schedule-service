import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/server/auth/context";
import { profileBody, unauthorizedResponse } from "@/server/auth/responses";
import { createAuthRepository } from "@/server/repositories/auth-repository";

// GET /api/auth/session: dono e tenant da sessão atual (tenantId injetado pelo proxy).
export async function GET(request: NextRequest) {
  const context = getAuthContext(request.headers);
  if (!context) return unauthorizedResponse();
  const profile = await createAuthRepository().findProfile(context.tenantId, context.userId);
  if (!profile) return unauthorizedResponse();
  return NextResponse.json(profileBody(profile));
}
