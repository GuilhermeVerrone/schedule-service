import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Band, SiteEmpty, SiteHead, TeamList } from "@/components/site/site-blocks";
import { loadPublicSite, siteMetadata } from "@/server/public-site/load-site";

export async function generateMetadata({ params }: PageProps<"/[slug]/equipe">): Promise<Metadata> {
  const site = await loadPublicSite((await params).slug);
  return site ? siteMetadata(site, "equipe") : {};
}

// Profissionais ativos que atendem ao menos um serviço ativo (D2).
export default async function SiteTeamPage({ params }: PageProps<"/[slug]/equipe">) {
  const site = await loadPublicSite((await params).slug);
  if (!site) notFound();
  const { services, professionals } = site;

  return (
    <Band tone="paper">
      <SiteHead title="Equipe" lead="Quem atende e quais serviços cada profissional faz." />
      {professionals.length === 0 ? (
        <SiteEmpty
          title="Nenhum profissional disponível no momento."
          detail="Este negócio ainda não publicou a equipe. Volte mais tarde ou fale direto com ele."
        />
      ) : (
        <TeamList professionals={professionals} services={services} />
      )}
    </Band>
  );
}
