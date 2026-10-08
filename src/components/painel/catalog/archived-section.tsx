"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Lista de arquivados, recolhida por padrão (D6: arquivar não apaga; daqui dá para restaurar).
export function ArchivedSection({
  count,
  open,
  onToggle,
  noun,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  noun: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12" aria-label={`${noun} arquivados`}>
      <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open} className="-ml-4">
        <ChevronDownIcon aria-hidden="true" className={cn("transition-transform duration-180 ease-brand-out", open && "rotate-180")} />
        {open ? "Ocultar arquivados" : `Ver arquivados (${count})`}
      </Button>
      {open && <ul className="mt-3 animate-in border-b border-line duration-300 fade-in-0">{children}</ul>}
    </section>
  );
}
