import type { Metadata } from "next";
import { cache } from "react";
import type { SitePage } from "@/components/site/site-nav-items";
import { createPublicRepository, type PublicSite } from "@/server/repositories/public-repository";

// Leitura do mini-site em /{slug} (D1, D2). O tenant vem só do slug da URL, pelo repositório
// público, que já devolve só campos públicos e só serviços e profissionais ativos e vinculados.
// cache() divide a leitura entre o layout, a página e generateMetadata na mesma requisição.
export const loadPublicSite = cache(async (slug: string): Promise<PublicSite | null> => {
  return createPublicRepository().getSite(slug);
});

const DESCRIPTION_MAX = 160;

// Descrição curta para buscadores e compartilhamento: a do negócio (cortada numa palavra) ou
// uma frase montada com o nome.
export function siteDescription(site: Pick<PublicSite, "business">, page: SitePage): string {
  const { name, description } = site.business;
  if (page === "servicos") return `Serviços, duração e preços de ${name}.`;
  if (page === "equipe") return `Conheça a equipe de ${name} e o que cada profissional atende.`;
  if (page === "agendar") return `Agende um horário em ${name}: escolha o serviço, o profissional e o horário livre.`;
  const text = description?.replace(/\s+/g, " ").trim();
  if (!text) return `Serviços, equipe e contato de ${name}.`;
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

const PAGE_TITLE: Record<SitePage, string | null> = { inicio: null, servicos: "Serviços", equipe: "Equipe", agendar: "Agendar" };

export function siteMetadata(site: PublicSite, page: SitePage): Metadata {
  const { name } = site.business;
  const pageTitle = PAGE_TITLE[page];
  const title = pageTitle ? `${pageTitle} · ${name}` : name;
  const description = siteDescription(site, page);
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: name, locale: "pt_BR" },
  };
}

// Página do link de gestão (D6): o token está no caminho, então nada de indexar nem de Referer.
export function manageMetadata(site: PublicSite): Metadata {
  return {
    title: `Seu agendamento · ${site.business.name}`,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}
