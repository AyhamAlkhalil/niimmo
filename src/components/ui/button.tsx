import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Anthrazit als Hauptknopf mit feinem Lichtrand, Karmin nur für „brand“ und Löschen.
// Kleiner Druckeffekt (active:translate-y-px) statt Farbsprung (26.10.2026).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-[-0.005em] ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-sanft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-knopf hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-knopf hover:bg-destructive/90",
        outline:
          "border border-input bg-card text-foreground shadow-sm hover:border-neutral-300 hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground hover:border-input hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-brand underline-offset-4 hover:underline",
        brand: "bg-brand text-brand-foreground shadow-knopf hover:bg-brand/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
