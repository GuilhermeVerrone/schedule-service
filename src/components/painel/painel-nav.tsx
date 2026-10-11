"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";
import { PANEL_NAV } from "./nav-items";

// Links do painel (DESIGN.md > Navigation): Manrope 500 em tamanho small, placa tint no hover.
// A página atual ganha peso 600 e um traço grafite embaixo, não só uma mudança de cor.
// No celular a lista rola na horizontal: a página atual entra na área visível (sem rolar a página).
export function PainelNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const box = current.getBoundingClientRect();
    const area = nav.getBoundingClientRect();
    if (box.right > area.right) nav.scrollLeft += box.right - area.right + 16;
    else if (box.left < area.left) nav.scrollLeft -= area.left - box.left + 16;
  }, [pathname]);
  return <PainelNavLinks ref={ref} className={className} pathname={pathname} />;
}

// Fallback do <Suspense> no layout: os mesmos links, sem marcar a página atual. Em rotas com
// parâmetro dinâmico (/painel/profissionais/[id]/horarios) o caminho só existe na requisição.
export function PainelNavLinks({
  className,
  pathname,
  ref,
}: {
  className?: string;
  pathname: string | null;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <nav ref={ref} aria-label="Painel" className={className}>
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
