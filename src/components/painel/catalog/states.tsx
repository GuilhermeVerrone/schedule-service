import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";

// Estados das listas do painel (D7): carregando (linhas fantasma entre réguas), vazio (texto
// curto + a ação que resolve) e erro (placa vermelha suave + "Tentar de novo").

export function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="border-b border-line">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex items-center gap-4 border-t border-line py-5">
          <div className="flex flex-1 flex-col gap-2">
            <span className="h-5 w-48 max-w-[70%] animate-pulse rounded-sheet bg-tint" />
            <span className="h-4 w-32 max-w-[50%] animate-pulse rounded-sheet bg-tint" />
          </div>
          <span className="h-control-sm w-24 animate-pulse rounded-control bg-tint" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 border-y border-line py-[clamp(2rem,1.5rem+2vw,3.5rem)]">
      <h2 className="text-title text-ink">{title}</h2>
      <p className="max-w-[52ch] text-body text-ink-2">{detail}</p>
      {action}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 border-y border-line py-8">
      <FormAlert message={`Não foi possível carregar. ${message}`} />
      <Button variant="outline" onClick={onRetry}>
        <RotateCcwIcon aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
