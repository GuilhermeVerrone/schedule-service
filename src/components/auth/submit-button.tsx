import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Botão primário do formulário, com estado de envio (desabilitado + indicador).
export function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full">
      {pending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {pending ? pendingLabel : label}
    </Button>
  );
}
