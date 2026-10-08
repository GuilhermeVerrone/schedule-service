"use client";

import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Campo de formulário (DESIGN.md > Inputs): rótulo acima, dica em ink-3, erro em danger abaixo,
// ligado ao input por aria-describedby para o leitor de tela anunciar.

interface FieldProps extends Omit<ComponentProps<"input">, "id" | "name"> {
  name: string;
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ name, label, hint, error, type = "text", ...inputProps }: FieldProps) {
  const [revealed, setRevealed] = useState(false);
  const id = `campo-${name}`;
  const hintId = hint ? `${id}-dica` : undefined;
  const errorId = error ? `${id}-erro` : undefined;
  const isPassword = type === "password";

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={isPassword && revealed ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className={isPassword ? "pr-13" : undefined}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={revealed}
            aria-controls={id}
            className="absolute top-1/2 right-1 flex size-chip -translate-y-1/2 cursor-pointer items-center justify-center rounded-control text-ink-2 transition-colors duration-160 outline-none hover:bg-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-violet"
          >
            {revealed ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={errorId} className="text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-micro text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
