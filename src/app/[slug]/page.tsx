import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Band, ServiceList, SiteEmpty, SiteHead } from "@/components/site/site-blocks";
import { sitePath, telHref } from "@/components/site/site-nav-items";
import { loadPublicSite, siteMetadata } from "@/server/public-site/load-site";

const PREVIEW = 3;

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const site = await loadPublicSite((await params).slug);
  return site ? siteMetadata(site, "inicio") : {};
}

// Início do site (guia 7a): nome e descrição do negócio, uma prévia dos serviços e o contato.
export default async function SiteHomePage({ params }: PageProps<"/[slug]">) {
  const site = await loadPublicSite((await params).slug);
  if (!site) notFound();
  const { business, services, professionals } = site;
  const tel = business.phone ? telHref(business.phone) : null;
  const hasContact = Boolean(business.address || business.phone);

  return (
    <>
      <section className="bg-paper">
        <div className="mx-auto w-full max-w-page px-gutter py-section">
          <h1 className="max-w-[18ch] text-display break-words text-ink">{business.name}</h1>
          <p className="mt-6 max-w-[60ch] text-lead whitespace-pre-line text-ink-2">
            {business.description?.trim() || "Conheça os serviços e a equipe."}
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href={sitePath(business.slug, "servicos")} className={buttonVariants({ className: "w-full sm:w-auto" })}>
              Ver serviços e preços
            </Link>
            <Link
              href={sitePath(business.slug, "equipe")}
              className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}
            >
              Conhecer a equipe
            </Link>
          </div>
        </div>
      </section>

      <Band tone="surface" label="Serviços">
        <SiteHead
          level={2}
          title="Serviços"
          lead={
            services.length > PREVIEW
              ? `Alguns dos ${services.length} serviços, com duração e preço.`
              : "Duração e preço de cada atendimento."
          }
        />
        {services.length === 0 ? (
          <SiteEmpty
            title="Nenhum serviço disponível no momento."
            detail="Este negócio ainda não publicou os serviços. Volte mais tarde ou fale direto com ele."
          />
        ) : (
          <>
            <ServiceList services={services.slice(0, PREVIEW)} professionals={professionals} />
            {services.length > PREVIEW && (
              <Link
                href={sitePath(business.slug, "servicos")}
                className={buttonVariants({ variant: "outline", className: "mt-8 w-full sm:w-auto" })}
              >
                Ver todos os serviços
              </Link>
            )}
          </>
        )}
      </Band>

      {hasContact && (
        <Band tone="paper" label="Contato">
          <SiteHead level={2} title="Contato" lead="Onde fica e como falar com o negócio." />
          <dl className="border-b border-line">
            {business.address && (
              <div className="flex flex-col gap-1 border-t border-line py-5 sm:flex-row sm:gap-6">
                <dt className="text-small font-semibold text-ink sm:w-40 sm:shrink-0">Endereço</dt>
                <dd className="min-w-0 text-body break-words text-ink">{business.address}</dd>
              </div>
            )}
            {business.phone && (
              <div className="flex flex-col gap-1 border-t border-line py-5 sm:flex-row sm:gap-6">
                <dt className="text-small font-semibold text-ink sm:w-40 sm:shrink-0">Telefone</dt>
                <dd className="min-w-0 text-body text-ink">
                  {tel ? (
                    <a href={tel} className="underline-offset-4 hover:underline">
                      {business.phone}
                    </a>
                  ) : (
                    business.phone
                  )}
                </dd>
              </div>
            )}
          </dl>
        </Band>
      )}
    </>
  );
}
