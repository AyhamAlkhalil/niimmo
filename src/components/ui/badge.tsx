import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-xs font-medium tracking-[0.005em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground hover:bg-accent",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85",
        outline: "border-input bg-card text-foreground",
        success: "border-success/20 bg-success/[0.08] text-success",
        warning: "border-warning/20 bg-warning/[0.08] text-warning",
        brand: "border-brand/15 bg-brand-soft text-brand",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

// forwardRef: Als Auslöser eines Tooltips (asChild) braucht das Etikett eine Ref, sonst
// warnt React und der Tooltip findet sein Bezugselement nicht (26.10.2026)
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
))
Badge.displayName = "Badge"

export { Badge, badgeVariants }
