"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

// An Apple-style switch (ADR-0042): green when on; a labelled role="switch".
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent bg-fill transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-toggle",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[1.125rem] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-px"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
