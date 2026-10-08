import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/server/auth/auth-service";
import { clearSessionCookie, SESSION_COOKIE } from "@/server/auth/session";

// POST /api/auth/logout: apaga a sessão no banco e o cookie (premissa c). Idempotente.
export async function POST(request: NextRequest) {
  await logout(request.cookies.get(SESSION_COOKIE)?.value);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
