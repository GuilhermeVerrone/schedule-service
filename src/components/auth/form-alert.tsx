import { CircleAlertIcon } from "lucide-react";

// Alerta de falha do formulário (DESIGN.md > Inputs > Error): placa vermelha suave, ícone em
// danger e texto em grafite. role="alert" para ser anunciado assim que aparece.
export function FormAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-control bg-danger/8 px-4 py-3 text-small text-ink">
      <CircleAlertIcon className="mt-0.5 size-[18px] shrink-0 text-danger" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
