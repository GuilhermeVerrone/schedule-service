import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Suspense } from "react";
import { getCurrentProfile } from "@/server/auth/current-profile";

export const metadata: Metadata = { title: "Painel · Slotz" };

// Início do painel: saudação com o nome do negócio e os passos para deixar a agenda pronta,
// em linhas numeradas separadas por réguas (DESIGN.md > Services Index).
const steps = [
  {
    numeral: "01",
    name: "Cadastre seus serviços",
    detail: "Nome, duração e preço de cada atendimento.",
    href: "/painel/servicos",
    action: "Ir para serviços",
  },
  {
    numeral: "02",
    name: "Cadastre sua equipe",
    detail: "Quem atende e quais serviços cada pessoa faz.",
    href: "/painel/profissionais",
    action: "Ir para profissionais",
  },
  {
    numeral: "03",
    name: "Defina os horários",
    detail: "Os dias e intervalos em que cada profissional atende.",
    href: "/painel/profissionais",
    action: "Ir para horários",
  },
] as const;

export default function PainelPage() {
  return (
    <div className="mx-auto max-w-page px-gutter pt-[clamp(2rem,1rem+3vw,4rem)] pb-section">
      <Suspense fallback={<GreetingSkeleton />}>
        <Greeting />
      </Suspense>
      <p className="mt-4 max-w-[60ch] text-lead text-ink-2">
        Deixe o básico pronto para começar a receber agendamentos.
      </p>

      <ol className="mt-head-gap border-b border-line">
        {steps.map((step) => (
          <li key={step.numeral} className="border-t border-line">
            <Link
              href={step.href}
              aria-label={`${step.name}: ${step.action}`}
              className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 gap-y-1 rounded-control py-5 text-ink no-underline outline-none transition-colors duration-180 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet sm:grid-cols-[4rem_1fr_1.2fr_auto] sm:gap-x-6 sm:px-2 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-tint"
            >
              <span className="font-heading text-title text-numeral-rest tabular-nums transition-colors duration-180 [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-violet">
                {step.numeral}
              </span>
              <span className="font-heading text-title text-ink">{step.name}</span>
              <span className="col-start-2 row-start-2 text-small text-ink-2 sm:col-start-3 sm:row-start-1">
                {step.detail}
              </span>
              <span
                aria-hidden="true"
                className="col-start-3 row-span-2 row-start-1 flex size-11 items-center justify-center rounded-pill border border-line-strong text-ink transition-[background-color,border-color,color] duration-180 sm:col-start-4 sm:row-span-1 [@media(hover:hover)_and_(pointer:fine)]:group-hover:border-ink [@media(hover:hover)_and_(pointer:fine)]:group-hover:bg-ink [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-on-dark"
              >
                <ArrowRightIcon className="size-[18px]" />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

async function Greeting() {
  const { tenant } = await getCurrentProfile();
  return <h1 className="max-w-[22ch] text-headline text-ink">Olá, {tenant.name}</h1>;
}

function GreetingSkeleton() {
  return (
    <div aria-hidden="true" className="h-[clamp(1.75rem,1.35rem+1.5vw,2.5rem)] w-72 max-w-full animate-pulse rounded-sheet bg-tint" />
  );
}
