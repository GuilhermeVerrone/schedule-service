import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site/site-nav";
import { telHref } from "@/components/site/site-nav-items";
import { loadPublicSite } from "@/server/public-site/load-site";

// Site público do negócio em /{slug} (D1, D2): Início, Serviços e Equipe. As rotas do Slotz
// (/login, /cadastro, /painel, /api) são estáticas e vencem este segmento; os slugs reservados
// e os que não existem caem no 404.
//
// O status 404 do slug inexistente sai do proxy (src/proxy.ts), antes do streaming. Aqui o
// negócio é lido antes de qualquer <Suspense> (cabeçalho e rodapé dependem dele) e o notFound()
// cobre o caso raro de o negócio sumir entre o proxy e a página. Por isso a rota bloqueia até a
// leitura terminar e fica fora da validação de navegação instantânea.
export const instant = false;

export default async function SiteLayout({ children, params }: LayoutProps<"/[slug]">) {
  const { slug } = await params;
  const site = await loadPublicSite(slug);
  if (!site) notFound();
  const { business } = site;
  const tel = business.phone ? telHref(business.phone) : null;

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only z-40 rounded-control bg-surface px-4 py-3 text-label text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-2 focus:outline-violet"
      >
        Ir para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-header max-w-page items-center gap-6 px-gutter">
          <Link
            href={`/${business.slug}`}
            className="-mx-2 min-w-0 truncate rounded-control px-2 py-1 font-heading text-title text-ink no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-violet"
          >
            {business.name}
          </Link>
          <SiteNav slug={business.slug} className="ml-auto hidden min-[860px]:block" />
        </div>
        <SiteNav slug={business.slug} className="mx-auto max-w-page px-gutter pb-2 min-[860px]:hidden" />
      </header>

      <main id="conteudo" className="flex-1">
        {children}
      </main>

      <footer className="bg-night">
        <div className="mx-auto flex max-w-page flex-col gap-6 px-gutter py-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-heading text-title break-words text-on-dark">{business.name}</p>
            {(business.address || business.phone) && (
              <address className="mt-2 flex flex-col gap-1 text-small text-on-dark-2 not-italic">
                {business.address && <span className="break-words">{business.address}</span>}
                {business.phone &&
                  (tel ? (
                    <a href={tel} className="w-fit text-on-dark underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-dark">
                      {business.phone}
                    </a>
                  ) : (
                    <span>{business.phone}</span>
                  ))}
              </address>
            )}
          </div>
          <p className="text-micro text-on-dark-2">Agenda online com Slotz</p>
        </div>
      </footer>
    </>
  );
}
