// Menu do site público em /{slug} (guia 3, D2): Início, Serviços, Equipe e Agendar.

export type SitePage = "inicio" | "servicos" | "equipe" | "agendar";

export const SITE_NAV: readonly { page: SitePage; label: string; path: string }[] = [
  { page: "inicio", label: "Início", path: "" },
  { page: "servicos", label: "Serviços", path: "/servicos" },
  { page: "equipe", label: "Equipe", path: "/equipe" },
  { page: "agendar", label: "Agendar", path: "/agendar" },
];

export function sitePath(slug: string, page: SitePage): string {
  const item = SITE_NAV.find((entry) => entry.page === page)!;
  return `/${slug}${item.path}`;
}

// Página atual pelo caminho: "/{slug}" é o Início; as demais casam pelo prefixo.
export function currentSitePage(slug: string, pathname: string): SitePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const item of SITE_NAV) {
    const href = `/${slug}${item.path}`;
    if (item.path === "" ? path === href : path === href || path.startsWith(`${href}/`)) return item.page;
  }
  return null;
}

// Telefone do negócio é texto livre (até 30 caracteres): o link tel: leva só os dígitos, com +
// quando o número foi escrito com DDI ("+55 ...").
export function telHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}
