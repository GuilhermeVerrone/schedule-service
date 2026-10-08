"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

// Rótulo acima do campo: small 600 (DESIGN.md > Inputs).
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-small font-semibold text-ink select-none", className)}
      {...props}
    />
  )
}

export { Label }
