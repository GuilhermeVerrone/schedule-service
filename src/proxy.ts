import { NextResponse, type NextRequest } from "next/server";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { unauthorizedResponse } from "@/server/auth/responses";
import { isAccessPath, isPanelPath, LOGIN_PATH, PANEL_PATH } from "@/server/auth/redirects";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, validateSession } from "@/server/auth/session";

// Proxy (o antigo middleware do Next): valida a sessão no banco e injeta tenantId/userId na
// requisição (guia 6). Os cabeçalhos vindos do cliente são sempre apagados antes, então só o
// proxy consegue preenchê-los. Toda rota /api exige sessão, salvo as públicas abaixo. Nas
// telas, /painel sem sessão vai para o login e /login ou /cadastro com sessão vão para o painel.

const PUBLIC_API_ROUTES = new Set(["/api/auth/register", "/api/auth/login", "/api/auth/logout"]);

function isProtectedApi(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (path === "/api" || path.startsWith("/api/")) && !PUBLIC_API_ROUTES.has(path);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(TENANT_ID_HEADER);
  headers.delete(USER_ID_HEADER);

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateSession(token) : null;

  // Renova o cookie (sessão deslizante) ou apaga um token que não vale mais.
  const finish = (response: NextResponse): NextResponse => {
    if (session?.renewed && token) setSessionCookie(response, token, session.expiresAt);
    if (token && !session) clearSessionCookie(response);
    return response;
  };

  const { pathname, search } = request.nextUrl;
  if (!session && isProtectedApi(pathname)) return unauthorizedResponse();
  if (!session && isPanelPath(pathname)) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return finish(NextResponse.redirect(login));
  }
  if (session && isAccessPath(pathname)) return finish(NextResponse.redirect(new URL(PANEL_PATH, request.url)));

  if (session) {
    headers.set(TENANT_ID_HEADER, session.tenantId);
    headers.set(USER_ID_HEADER, session.userId);
  }
  return finish(NextResponse.next({ request: { headers } }));
}

export const config = {
  matcher: ["/api/:path*", "/painel/:path*", "/login", "/cadastro"],
};
