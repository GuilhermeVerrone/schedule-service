"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { UNIT_LABELS, type DurationUnit } from "./duration";

// Campos da tela de configurações no padrão do Field (DESIGN.md > Inputs): rótulo acima, dica em
// ink-3, erro em danger abaixo, ligados por aria-describedby.

export const CONTROL =
  "w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-base text-ink transition-[border-color,box-shadow] duration-160 outline-none placeholder:text-ink-3 focus-visible:border-violet focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-danger";

function describedBy(id: string, hint?: string, error?: string) {
  return {
    hintId: hint && !error ? `${id}-dica` : undefined,
    errorId: error ? `${id}-erro` : undefined,
  };
}

function FieldMessage({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  const { hintId, errorId } = describedBy(id, hint, error);
  if (error) {
    return (
      <p id={errorId} className="text-small text-danger">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={hintId} className="text-micro text-ink-3">
      {hint}
    </p>
  ) : null;
}

// Texto longo (DESIGN.md: textarea de 120px no mínimo), com contador do limite.
export function TextareaField({
  name,
  label,
  hint,
  error,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "id" | "name"> & { name: string; label: string; hint?: string; error?: string }) {
  const id = `campo-${name}`;
  const { hintId, errorId } = describedBy(id, hint, error);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={cn(CONTROL, "min-h-[120px] resize-y py-3 leading-[1.5]", className)}
        {...props}
      />
      <FieldMessage id={id} hint={hint} error={error} />
    </div>
  );
}

// Tempo com unidade: número + minutos/horas/dias. O rótulo nomeia o número; a unidade tem o
// próprio rótulo para o leitor de tela.
export function DurationField({
  name,
  label,
  hint,
  error,
  amount,
  unit,
  onAmountChange,
  onUnitChange,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  amount: string;
  unit: DurationUnit;
  onAmountChange: (value: string) => void;
  onUnitChange: (unit: DurationUnit) => void;
}) {
  const id = `campo-${name}`;
  const { hintId, errorId } = describedBy(id, hint, error);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
        <Input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        />
        <div className="relative">
          <select
            name={`${name}-unidade`}
            aria-label={`Unidade de ${label.toLowerCase()}`}
            value={unit}
            onChange={(event) => onUnitChange(event.target.value as DurationUnit)}
            className={cn(CONTROL, "h-input cursor-pointer appearance-none pr-10")}
          >
            {(Object.keys(UNIT_LABELS) as DurationUnit[]).map((option) => (
              <option key={option} value={option}>
                {UNIT_LABELS[option]}
              </option>
            ))}
          </select>
          <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-ink-2" />
        </div>
      </div>
      <FieldMessage id={id} hint={hint} error={error} />
    </div>
  );
}
