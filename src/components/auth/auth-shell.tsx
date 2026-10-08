import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

// Moldura das telas de acesso, no padrão da faixa de contato da Algoritmi: introdução à esquerda
// (colunas 1 a 5) e o formulário num painel branco à direita (7 a 12). Empilha abaixo de 900px.

interface AuthShellProps {
  title: string;
  lead: string;
  formTitle: string;
  aside: { href: string; label: string };
  points?: { numeral: string; text: string }[];
  children: ReactNode;
}

export function AuthShell({ title, lead, formTitle, aside, points, children }: AuthShellProps) {
  return (
    <>
      <header className="h-header">
        <div className="mx-auto flex h-full max-w-page items-center justify-between px-gutter">
          <Wordmark />
          <Link href={aside.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {aside.label}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto grid max-w-page gap-x-6 gap-y-8 px-gutter pt-6 pb-section min-[900px]:grid-cols-12 min-[900px]:pt-[clamp(2.5rem,1rem+4vw,5rem)]">
          <div className="min-[900px]:col-span-5">
            <h1 className="max-w-[15ch] text-headline text-ink">{title}</h1>
            <p className="mt-4 max-w-[48ch] text-lead text-ink-2">{lead}</p>
            {points && (
              <ol className="mt-head-gap hidden border-b border-line min-[900px]:block">
                {points.map((point) => (
                  <li key={point.numeral} className="grid grid-cols-[3rem_1fr] items-baseline border-t border-line py-4">
                    <span className="font-heading text-title text-numeral-rest tabular-nums">{point.numeral}</span>
                    <span className="text-small text-ink-2">{point.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <section
            aria-labelledby="titulo-formulario"
            className="rounded-panel border border-line bg-surface p-[clamp(1.5rem,1rem+2vw,2.75rem)] shadow-rest min-[900px]:col-span-6 min-[900px]:col-start-7 min-[900px]:self-start"
          >
            <h2 id="titulo-formulario" className="mb-6 text-title text-ink">
              {formTitle}
            </h2>
            {children}
          </section>
        </div>
      </main>
    </>
  );
}
