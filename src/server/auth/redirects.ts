// Redirecionamentos das telas de acesso (guia 7a, 7b). Sem sessão, /painel manda para o login
// guardando o destino em ?next=; com sessão, /login e /cadastro mandam para o painel.

export const LOGIN_PATH = "/login";
export const REGISTER_PATH = "/cadastro";
export const PANEL_PATH = "/painel";
// Marca no /login que a pessoa acabou de sair (a tela mostra o aviso e limpa a URL).
export const LOGGED_OUT_PARAM = "saiu";

export function isPanelPath(pathname: string): boolean {
  return pathname === PANEL_PATH || pathname.startsWith(`${PANEL_PATH}/`);
}

export function isAccessPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === LOGIN_PATH || path === REGISTER_PATH;
}

// Só aceita caminhos do próprio painel: nada de URL absoluta, "//host" ou "\" (redirecionamento
// aberto). Qualquer outra coisa volta para /painel.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return PANEL_PATH;
  try {
    const url = new URL(next, "http://slotz.invalid");
    if (url.origin !== "http://slotz.invalid" || !isPanelPath(url.pathname)) return PANEL_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return PANEL_PATH;
  }
}
