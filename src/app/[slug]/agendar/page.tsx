import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/site/booking/booking-flow";
import { Band, SiteHead } from "@/components/site/site-blocks";
import { loadPublicSite, siteMetadata } from "@/server/public-site/load-site";

export async function generateMetadata({ params }: PageProps<"/[slug]/agendar">): Promise<Metadata> {
  const site = await loadPublicSite((await params).slug);
  return site ? siteMetadata(site, "agendar") : {};
}

// Agendar (guia 7a, 7b; D5, D6, D8): o fluxo em passos roda no navegador sobre a API pública;
// daqui vão só os campos públicos do negócio e o catálogo ativo e vinculado.
export default async function SiteBookingPage({ params }: PageProps<"/[slug]/agendar">) {
  const site = await loadPublicSite((await params).slug);
  if (!site) notFound();
  const { business, services, professionals } = site;

  return (
    <Band tone="paper">
      <SiteHead title="Agendar" lead="Escolha o serviço, o profissional e um horário livre. Leva menos de um minuto." />
      <BookingFlow
        business={{
          slug: business.slug,
          name: business.name,
          timezone: business.timezone,
          maxWindowDays: business.maxWindowDays,
          cancelDeadlineMinutes: business.cancelDeadlineMinutes,
        }}
        services={services}
        professionals={professionals}
      />
    </Band>
  );
}
