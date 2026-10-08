import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

// Campo no padrão Algoritmi (DESIGN.md > Inputs): branco, borda line-strong, raio de controle,
// 50px, Manrope 1rem (16px também evita o zoom do iOS). Foco: borda violeta + anel de 3px a 18%.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-input w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-base text-ink transition-[border-color,box-shadow] duration-160 outline-none placeholder:text-ink-3 focus-visible:border-violet focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
