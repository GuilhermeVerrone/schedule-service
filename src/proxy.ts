import { NextResponse, type NextRequest } from "next/server";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { unauthorizedResponse } from "@/server/auth/responses";
import { isAccessPath, isPanelPath, LOGIN_PATH, PANEL_PATH } from "@/server/auth/redirects";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, validateSession } from "@/server/auth/session";
import { createPublicRepository } from "@/server/repositories/public-repository";

// Proxy (o antigo middleware do Next): valida a sessão no banco e injeta tenantId/userId na
// requisição (guia 6). Os cabeçalhos vindos do cliente são sempre apagados antes, então só o
// proxy consegue preenchê-los. Toda rota /api exige sessão, salvo as públicas abaixo e o prefixo
// /api/public/ do site do negócio (D1), que resolve o tenant pelo slug e nunca pela sessão: lá o
// proxy só apaga os cabeçalhos, sem ler o cookie. O webhook do WhatsApp (D8) segue a mesma regra:
// sem sessão e sem tenantId injetado; a rota confere o segredo e resolve o tenant pela sessão do
// provedor. Nas telas, /painel sem sessão vai para o login
// e /login ou /cadastro com sessão vão para o painel.
// Site do negócio em /{slug}/... (D1, guia 7f): o proxy confere só se o slug existe e, se não,
// responde 404 já aqui. A página é servida em streaming (cacheComponents) e, dentro dela, o
// notFound() chegaria depois do status 200. Também não lê a sessão nessas páginas.

const PUBLIC_API_ROUTES = new Set(["/api/auth/register", "/api/auth/login", "/api/auth/logout"]);
export const PUBLIC_API_PREFIX = "/api/public/";

const trimSlash = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);

export function isPublicSiteApi(pathname: string): boolean {
  return trimSlash(pathname).startsWith(PUBLIC_API_PREFIX);
}

// Webhooks de provedores: rota fixa, autenticada pelo segredo do provedor, nunca pela sessão.
export const WEBHOOK_ROUTES = new Set(["/api/webhooks/whatsapp"]);

export function isWebhookApi(pathname: string): boolean {
  return WEBHOOK_ROUTES.has(trimSlash(pathname));
}

// Primeiros segmentos que são do próprio Slotz e nunca de um site de negócio.
const APP_SEGMENTS = new Set(["api", "painel", "login", "cadastro", "_next"]);

// Slug do site público no caminho ("/studio-bela/servicos" → "studio-bela"), ou null quando o
// caminho é do app ou de um arquivo ("/favicon.ico").
export function publicSiteSlug(pathname: string): string | null {
  const [first] = trimSlash(pathname).slice(1).split("/");
  if (!first || first.includes(".") || APP_SEGMENTS.has(first)) return null;
  return first;
}

const NOT_FOUND_PATH = "/_slotz/nao-encontrado";

function isProtectedApi(pathname: string): boolean {
  const path = trimSlash(pathname);
  return (
    (path === "/api" || path.startsWith("/api/")) &&
    !PUBLIC_API_ROUTES.has(path) &&
    !isPublicSiteApi(path) &&
    !isWebhookApi(path)
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(TENANT_ID_HEADER);
  headers.delete(USER_ID_HEADER);

  // Site público e webhooks: nem sessão, nem tenantId injetado (mesmo com o dono logado no navegador).
  if (isPublicSiteApi(request.nextUrl.pathname) || isWebhookApi(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const siteSlug = publicSiteSlug(request.nextUrl.pathname);
  if (siteSlug !== null) {
    const tenant = await createPublicRepository().resolveTenant(siteSlug);
    if (tenant) return NextResponse.next({ request: { headers } });
    // Caminho sem rota no app: renderiza o not-found da raiz com status 404 de verdade.
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url), { status: 404 });
  }

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
  matcher: [
    "/api/:path*",
    "/painel/:path*",
    "/login",
    "/cadastro",
    // Site do negócio: qualquer caminho fora do app e sem extensão de arquivo.
    "/((?!api/|api$|painel/|painel$|login$|cadastro$|_next/|.*\\.).+)",
  ],
};
