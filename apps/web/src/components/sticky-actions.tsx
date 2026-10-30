import { type ReactNode, useEffect } from 'react';

let shown = 0;

/**
 * The step's buttons at the foot of a long editor (ADR-0047 #5): the bar sticks to the bottom of
 * the window while the lines scroll under it, so posting never means scrolling past 100 lines.
 * Place it after the card, never inside: cards clip their content, which stops `sticky`. While a
 * bar is shown, toasts rise above it (`--sticky-actions-space`, read by the Toaster).
 */
export function StickyActions(props: { summary?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    shown += 1;
    document.documentElement.style.setProperty('--sticky-actions-space', '4rem');
    return () => {
      shown -= 1;
      if (shown === 0) document.documentElement.style.removeProperty('--sticky-actions-space');
    };
  }, []);
  return (
    <div className="sticky bottom-3 z-30 print:hidden">
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl bg-background/95 px-3 py-2.5 shadow-popover ring-1 ring-black/[0.06] backdrop-blur-md [&>button]:grow sm:[&>button]:grow-0">
        {props.summary ? (
          <div className="mr-auto min-w-0 text-[0.8125rem] text-muted-foreground">
            {props.summary}
          </div>
        ) : null}
        {props.children}
      </div>
    </div>
  );
}
