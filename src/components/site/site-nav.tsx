"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { currentSitePage, SITE_NAV, sitePath } from "./site-nav-items";

// Menu do site do negócio (DESIGN.md > Navigation): Manrope 500 em tamanho small, placa tint no
// hover. A página atual ganha peso 600 e um traço grafite embaixo, não só uma mudança de cor.
// Mesmo desenho do menu do painel; aqui são só três itens, então cabem inteiros no celular.
export function SiteNav({ slug, className }: { slug: string; className?: string }) {
  const pathname = usePathname();
  const current = currentSitePage(slug, pathname);
  return (
    <nav aria-label="Site" className={className}>
      <ul className="flex gap-1">
        {SITE_NAV.map((item) => {
          const active = item.page === current;
          return (
            <li key={item.page}>
              <Link
                href={sitePath(slug, item.page)}
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
