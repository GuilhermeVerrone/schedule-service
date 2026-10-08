import { Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Formulário que abre no lugar, dentro da linha (DESIGN.md > Services Index: "expand-in-place
// rows instead of cards"). Só um aberto por vez na tela. Palco branco de 16px com régua de 1px
// e entrada curta subindo 6px (ease-out da marca; prefers-reduced-motion já zera no globals.css).
export function RowPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "animate-in rounded-frame bg-surface p-[clamp(1.25rem,1rem+1.2vw,2rem)] ring-1 ring-line duration-300 ease-brand-out fade-in-0 slide-in-from-top-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Salvar (primário, com estado de envio) e Cancelar (contorno). No celular ocupam a largura toda.
export function FormActions({
  pending,
  submitLabel,
  pendingLabel,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="w-full sm:w-auto">
        Cancelar
      </Button>
      <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full sm:w-auto">
        {pending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}
