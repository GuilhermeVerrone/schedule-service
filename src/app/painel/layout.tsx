import { Suspense } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { AccountSummary, AccountSummarySkeleton } from "@/components/painel/account-summary";
import { LogoutButton } from "@/components/painel/logout-button";
import { PainelNav, PainelNavLinks } from "@/components/painel/painel-nav";

const MOBILE_NAV = "mx-auto max-w-page overflow-x-auto px-gutter pb-2 min-[1100px]:hidden";

// Moldura do /painel. A proteção fica no proxy (sem sessão → /login?next=...) e de novo em
// getCurrentProfile, nos trechos que leem a sessão (atrás de <Suspense>, cacheComponents).
// Cabeçalho de 72px em papel; abaixo de 1100px os links descem para uma segunda linha (com os
// sete itens do menu, a linha única só cabe a partir dessa largura).
export default function PainelLayout({ children }: LayoutProps<"/painel">) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-header max-w-page items-center gap-6 px-gutter">
          <Wordmark href="/painel" />
          <Suspense fallback={<PainelNavLinks pathname={null} className="hidden min-[1100px]:block" />}>
            <PainelNav className="hidden min-[1100px]:block" />
          </Suspense>
          <div className="ml-auto flex min-w-0 items-center gap-4">
            <Suspense fallback={<AccountSummarySkeleton />}>
              <AccountSummary />
            </Suspense>
            <LogoutButton />
          </div>
        </div>
        <Suspense fallback={<PainelNavLinks pathname={null} className={MOBILE_NAV} />}>
          <PainelNav className={MOBILE_NAV} />
        </Suspense>
      </header>
      <main id="conteudo" className="flex-1">
        {children}
      </main>
    </>
  );
}
