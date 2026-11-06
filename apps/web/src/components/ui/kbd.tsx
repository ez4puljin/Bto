import * as React from "react"
import { cn } from "cn"

// A key's name beside what it does. Hidden from screen readers: the control says the shortcut itself
// (`aria-keyshortcuts`) or the text beside it does.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      aria-hidden
      data-slot="kbd"
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-current/25 px-1 font-sans text-xs leading-none font-normal opacity-80",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
