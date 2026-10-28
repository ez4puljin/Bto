import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Status pills (ADR-0042): tinted backgrounds with dark text of the same hue. `default` is the
// blue "in progress" pill, `secondary` the neutral one; success / warning / destructive carry
// meaning (done, needs attention, refused or broken).
const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-info-soft text-link [a]:hover:bg-secondary-hover",
        secondary: "bg-fill text-foreground [a]:hover:bg-fill/80",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive:
          "bg-danger-soft text-destructive focus-visible:ring-destructive [a]:hover:bg-destructive/15",
        outline:
          "border-border text-muted-foreground [a]:hover:bg-accent [a]:hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-accent",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
