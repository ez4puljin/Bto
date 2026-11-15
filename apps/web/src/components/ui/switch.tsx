"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

// An Apple-style switch (ADR-0042): green when on; a labelled role="switch". Drawn 2.375×1.375rem
// (38×22px at a 16px root; in rem like its thumb, which ended past the track at a 19px root); a
// finger gets about 46×46px around it (ADR-0201), unseen, so a row of switches keeps its height.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.375rem] w-[2.375rem] shrink-0 touch-static:relative touch:after:absolute touch:after:-inset-x-1 touch:after:-inset-y-3 items-center rounded-full border border-transparent bg-fill transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-toggle",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[1.125rem] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform data-[state=checked]:translate-x-[calc(1.25rem-3px)] data-[state=unchecked]:translate-x-px"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
