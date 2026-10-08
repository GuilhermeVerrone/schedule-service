import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Botões no padrão Algoritmi (DESIGN.md > Buttons): 52px, raio de controle, Manrope 600.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control border bg-clip-padding text-label whitespace-nowrap no-underline transition-[background-color,border-color,color,transform] duration-180 ease-brand-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-violet active:not-aria-[haspopup]:scale-97 disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-violet text-on-dark hover:bg-violet-deep",
        outline:
          "border-line-strong bg-transparent text-ink hover:border-ink hover:bg-tint aria-expanded:bg-tint",
        secondary: "border-transparent bg-on-dark text-ink hover:bg-surface",
        ghost: "border-transparent text-ink hover:bg-tint aria-expanded:bg-tint",
        destructive:
          "border-transparent bg-danger/10 text-danger hover:bg-danger/15 focus-visible:outline-danger",
        link: "border-transparent text-violet-deep underline-offset-4 hover:underline",
      },
      size: {
        default: "h-control px-5.5",
        sm: "h-control-sm px-4",
        icon: "size-control",
        "icon-sm": "size-control-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
