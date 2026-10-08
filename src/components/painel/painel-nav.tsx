"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PANEL_NAV } from "./nav-items";

// Links do painel (DESIGN.md > Navigation): Manrope 500 em tamanho small, placa tint no hover.
// A página atual ganha peso 600 e um traço grafite embaixo, não só uma mudança de cor.
export function PainelNav({ className }: { className?: string }) {
  return <PainelNavLinks className={className} pathname={usePathname()} />;
}

// Fallback do <Suspense> no layout: os mesmos links, sem marcar a página atual. Em rotas com
// parâmetro dinâmico (/painel/profissionais/[id]/horarios) o caminho só existe na requisição.
export function PainelNavLinks({ className, pathname }: { className?: string; pathname: string | null }) {
  return (
    <nav aria-label="Painel" className={className}>
      <ul className="flex gap-1">
        {PANEL_NAV.map((item) => {
          const active = pathname !== null && (item.exact ? pathname === item.href : pathname.startsWith(item.href));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-chip items-center rounded-control px-3 text-small font-medium whitespace-nowrap text-ink-2 no-underline transition-colors duration-160 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink",
                  active &&
                    "font-semibold text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-pill after:bg-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
