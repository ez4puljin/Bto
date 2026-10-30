"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useScanEnterGuard } from "@/lib/scan/use-wedge-scanner"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/25 duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Dialog widths (ADR-0066): a question or ≤3 fields, a one-column form, two columns or a small table, a line editor. */
const DIALOG_SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const

/**
 * The element that had the focus when an overlay opened, focused again when it closes (ADR-0066):
 * the app's dialogs open from the URL or from a button that is not a Radix trigger, so Radix alone
 * would leave the focus on the page body. The opener is read when the overlay opens (a dialog that
 * stays mounted opens many times); a caller's own handlers run first and may take over.
 */
export function useReturnFocus(
  onOpenAutoFocus: ((event: Event) => void) | undefined,
  onCloseAutoFocus: ((event: Event) => void) | undefined
): { onOpenAutoFocus: (event: Event) => void; onCloseAutoFocus: (event: Event) => void } {
  const opener = React.useRef<Element | null>(null)
  return {
    onOpenAutoFocus: (event) => {
      opener.current = document.activeElement
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event)
      const target = opener.current
      opener.current = null
      if (event.defaultPrevented) return
      if (target instanceof HTMLElement && target !== document.body && target.isConnected) {
        event.preventDefault()
        target.focus()
      }
    },
  }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  size = "sm",
  onKeyDownCapture,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Screen-reader label of the close button; «Хаах» unless named. */
  closeLabel?: string
  size?: keyof typeof DIALOG_SIZES
}) {
  const { t } = useTranslation()
  // A barcode scan's Enter never presses the focused button (ADR-0047 #4).
  const scanGuard = useScanEnterGuard()
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100svh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-dialog ring-1 ring-black/[0.06] duration-200 ease-apple outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:duration-150 data-closed:fade-out-0 data-closed:zoom-out-95",
          DIALOG_SIZES[size],
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
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3 z-20 rounded-full text-muted-foreground"
              size="icon-sm"
              aria-label={closeLabel ?? t("common.close")}
              title={closeLabel ?? t("common.close")}
            >
              <XIcon />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  closeLabel,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Adds a close button with this (translated) label, left of the main button (ADR-0042). */
  closeLabel?: string
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Sticks to the foot of a dialog taller than the window, so its buttons stay in reach (ADR-0066).
        "sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border/80 bg-popover px-5 py-3 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {closeLabel && (
        <DialogPrimitive.Close asChild>
          <Button variant="ghost">{closeLabel}</Button>
        </DialogPrimitive.Close>
      )}
      {children}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading pr-8 text-[1.0625rem] leading-snug font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[0.8125rem] text-muted-foreground *:[a]:text-link *:[a]:underline *:[a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
