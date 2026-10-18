"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useReturnFocus } from "@/components/ui/dialog"
import { useScanEnterGuard } from "@/lib/scan/use-wedge-scanner"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/25 duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  closeLabel,
  onKeyDownCapture,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  /** Screen-reader label of the close button; «Хаах» unless named. */
  closeLabel?: string
}) {
  const { t } = useTranslation()
  // A barcode scan's Enter never presses the focused button (ADR-0047 #4).
  const scanGuard = useScanEnterGuard()
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus)
  return (
    <SheetPortal>
      <SheetOverlay />
      {/* `*:shrink-0`: the sheet scrolls; a card's overflow-hidden would otherwise let the column squeeze it. */}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] bg-popover p-5 text-sm text-popover-foreground shadow-dialog ring-1 ring-black/[0.06] duration-200 outline-none *:shrink-0 data-open:animate-in data-closed:animate-out",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full border-l sm:max-w-xl data-open:slide-in-from-right data-closed:slide-out-to-right",
          side === "left" &&
            "inset-y-0 left-0 h-full w-full border-r sm:max-w-xl data-open:slide-in-from-left data-closed:slide-out-to-left",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-open:slide-in-from-top data-closed:slide-out-to-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
          className
        )}
        onKeyDownCapture={(event) => {
          scanGuard(event)
          onKeyDownCapture?.(event)
        }}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        {...props}
      >
        {children}
        <SheetPrimitive.Close data-slot="sheet-close" asChild>
          <Button
            variant="ghost"
            className="absolute top-3 right-3 z-20 rounded-full text-muted-foreground"
            size="icon-sm"
            aria-label={closeLabel ?? t("common.close")}
            title={closeLabel ?? t("common.close")}
          >
            <XIcon />
          </Button>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        // Sticks to the foot of a sheet that scrolls, so its buttons stay in reach (ADR-0066).
        "sticky -bottom-5 z-10 -mx-5 -mb-5 mt-auto flex flex-col-reverse gap-2 border-t border-border/80 bg-popover px-5 py-3 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-[17px] leading-snug font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[13px] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
