"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Toasts no padrão Algoritmi: superfície branca, régua grafite, raio de frame, sombra grafite
// baixa. Só tema claro (o design system não tem modo escuro).
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[18px] text-ink" />,
        info: <InfoIcon className="size-[18px] text-ink" />,
        warning: <TriangleAlertIcon className="size-[18px] text-danger" />,
        error: <OctagonXIcon className="size-[18px] text-danger" />,
        loading: <Loader2Icon className="size-[18px] animate-spin text-ink-2" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
          "--border-radius": "16px",
          "--width": "min(380px, calc(100vw - 32px))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans text-small shadow-rest",
          title: "font-semibold",
          description: "text-ink-2",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
