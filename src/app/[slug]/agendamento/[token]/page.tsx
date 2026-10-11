import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManageAppointment } from "@/components/site/booking/manage-appointment";
import { Band } from "@/components/site/site-blocks";
import { loadPublicSite, manageMetadata } from "@/server/public-site/load-site";

export async function generateMetadata({ params }: PageProps<"/[slug]/agendamento/[token]">): Promise<Metadata> {
  const site = await loadPublicSite((await params).slug);
  return site ? manageMetadata(site) : {};
}

// Link de gestão (guia 7c, D6): o agendamento é lido pela API pública com o token, no navegador,
// sob o mesmo limite por IP das outras rotas. Nada do agendamento passa pelo HTML do servidor;
// os cabeçalhos sem Referer, cache e indexação vêm do next.config.ts.
export default async function ManageAppointmentPage({ params }: PageProps<"/[slug]/agendamento/[token]">) {
  const { slug, token } = await params;
  const site = await loadPublicSite(slug);
  if (!site) notFound();
  const { business, professionals } = site;

  return (
    <Band tone="paper">
      <ManageAppointment
        token={token}
        business={{
          slug: business.slug,
          name: business.name,
          phone: business.phone,
          timezone: business.timezone,
          maxWindowDays: business.maxWindowDays,
        }}
        professionals={professionals}
      />
    </Band>
  );
}
