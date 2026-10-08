"use client";

import { CheckIcon } from "lucide-react";
import type { ServiceDto } from "./api-client";
import { formatDuration } from "./money";

// Vínculo profissional × serviço (D5) como chips (DESIGN.md > Chips): pílula branca de 40px com
// borda line-strong; marcada fica violeta com texto em papel e mostra o check, que cresce de 0
// a 15px. É um checkbox de verdade por baixo, para teclado e leitor de tela.
export function ServiceChips({
  services,
  selected,
  onToggle,
}: {
  services: readonly ServiceDto[];
  selected: ReadonlySet<string>;
  onToggle: (serviceId: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {services.map((service) => {
        const checked = selected.has(service.id);
        return (
          <li key={service.id} className="max-w-full">
            <label className="group relative block max-w-full cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(service.id)}
                aria-describedby={`chip-${service.id}-dur`}
                className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
              />
              <span className="flex min-h-chip max-w-full items-center gap-0 rounded-pill border border-line-strong bg-surface px-3.5 text-small font-medium text-ink transition-[background-color,border-color,color,gap,transform] duration-160 ease-brand-out group-active:scale-97 peer-checked:gap-1.5 peer-checked:border-violet peer-checked:bg-violet peer-checked:text-on-dark peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:group-hover:border-ink [@media(hover:hover)_and_(pointer:fine)]:peer-checked:group-hover:border-violet-deep [@media(hover:hover)_and_(pointer:fine)]:peer-checked:group-hover:bg-violet-deep">
                <CheckIcon
                  aria-hidden="true"
                  strokeWidth={2.5}
                  className={`shrink-0 transition-[width,height] duration-160 ease-brand-out ${checked ? "size-[15px]" : "size-0"}`}
                />
                <span className="truncate">{service.name}</span>
                <span id={`chip-${service.id}-dur`} className="sr-only">
                  {formatDuration(service.durationMinutes)}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
