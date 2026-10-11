import type { ReactNode } from "react";
import { formatCents, formatDuration } from "@/components/painel/catalog/money";
import type { PublicProfessional, PublicService } from "@/server/repositories/public-repository";

// Peças do site público (DESIGN.md > Layout e Services Index): faixas de largura total com o
// mesmo respiro, título + lead, e listas em linhas entre réguas de 1px em vez de cards.

const LIST = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

export function joinNames(names: string[]): string {
  return LIST.format(names);
}

export function Band({ tone, children, label }: { tone: "paper" | "surface"; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className={tone === "surface" ? "bg-surface" : "bg-paper"}>
      <div className="mx-auto w-full max-w-page px-gutter py-section">{children}</div>
    </section>
  );
}

export function SiteHead({ title, lead, level = 1 }: { title: string; lead: string; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="mb-head-gap">
      <Heading className="max-w-[22ch] text-headline break-words text-ink">{title}</Heading>
      <p className="mt-4 max-w-[60ch] text-lead text-ink-2">{lead}</p>
    </div>
  );
}

export function SiteEmpty({ title, detail }: { title: string; detail: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-y border-line py-[clamp(2rem,1.5rem+2vw,3.5rem)]">
      <h2 className="text-title text-ink">{title}</h2>
      <p className="max-w-[52ch] text-body text-ink-2">{detail}</p>
    </div>
  );
}

// Índice de serviços: numeral em cinza de repouso, nome, duração e preço, e quem atende.
export function ServiceList({ services, professionals }: { services: PublicService[]; professionals: PublicProfessional[] }) {
  return (
    <ol aria-label="Serviços" className="border-b border-line">
      {services.map((service, index) => {
        // Na ordem da equipe (alfabética), não na dos ids dos vínculos.
        const names = professionals.filter((professional) => service.professionalIds.includes(professional.id)).map((p) => p.name);
        return (
          <li
            key={service.id}
            className="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1 border-t border-line py-6 sm:grid-cols-[4rem_1fr_auto] sm:items-baseline sm:gap-x-6"
          >
            <span aria-hidden="true" className="font-heading text-title text-numeral-rest tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="text-title break-words text-ink">{service.name}</h3>
              {names.length > 0 && <p className="mt-1 text-small text-ink-2">Com {joinNames(names)}</p>}
            </div>
            <p className="col-start-2 text-body text-ink tabular-nums sm:col-start-3 sm:text-right">
              {formatDuration(service.durationMinutes)}
              <span className="text-ink-3" aria-hidden="true">
                {"  ·  "}
              </span>
              <span className="sr-only">, </span>
              <span className="font-semibold">{formatCents(service.priceCents)}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// Equipe: nome e os serviços que cada profissional atende.
export function TeamList({ professionals, services }: { professionals: PublicProfessional[]; services: PublicService[] }) {
  return (
    <ul aria-label="Equipe" className="border-b border-line">
      {professionals.map((professional) => {
        // Na ordem dos serviços (alfabética), não na dos ids dos vínculos.
        const names = services.filter((service) => professional.serviceIds.includes(service.id)).map((s) => s.name);
        return (
          <li key={professional.id} className="flex flex-col gap-1 border-t border-line py-6 sm:flex-row sm:items-baseline sm:gap-6">
            <h3 className="text-title break-words text-ink sm:w-[min(22rem,40%)] sm:shrink-0">{professional.name}</h3>
            {names.length > 0 && <p className="min-w-0 text-body text-ink-2">Atende {joinNames(names)}</p>}
          </li>
        );
      })}
    </ul>
  );
}
