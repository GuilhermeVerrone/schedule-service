import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Band, ServiceList, SiteEmpty, SiteHead } from "@/components/site/site-blocks";
import { loadPublicSite, siteMetadata } from "@/server/public-site/load-site";

export async function generateMetadata({ params }: PageProps<"/[slug]/servicos">): Promise<Metadata> {
  const site = await loadPublicSite((await params).slug);
  return site ? siteMetadata(site, "servicos") : {};
}

// Serviços ativos e com profissional ativo vinculado (D2), com duração, preço e quem atende.
export default async function SiteServicesPage({ params }: PageProps<"/[slug]/servicos">) {
  const site = await loadPublicSite((await params).slug);
  if (!site) notFound();
  const { services, professionals } = site;

  return (
    <Band tone="paper">
      <SiteHead title="Serviços" lead="Duração, preço e quem atende cada serviço." />
      {services.length === 0 ? (
        <SiteEmpty
          title="Nenhum serviço disponível no momento."
          detail="Este negócio ainda não publicou os serviços. Volte mais tarde ou fale direto com ele."
        />
      ) : (
        <ServiceList services={services} professionals={professionals} />
      )}
    </Band>
  );
}
