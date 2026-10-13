import { CircleCheck, Info, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissToast, getToasts, pauseToasts, resumeToasts, subscribeToasts } from '@/lib/toast';

/**
 * The toasts of `lib/toast` (ADR-0042): a dark pill at the bottom of the screen (at the top on
 * phones, above the keyboard), each one a polite `status` so screen readers read it once.
 */
export function Toaster() {
  const { t } = useTranslation();
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (items.length === 0) return null;
  return (
    <section
      aria-label={t('toast.region')}
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-6 print:hidden"
      onMouseEnter={pauseToasts}
      onMouseLeave={resumeToasts}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-[#1d1d1f]/95 py-2 pr-2 pl-4 text-[13px] font-medium text-white shadow-popover animate-in fade-in-0 slide-in-from-bottom-2"
        >
          {item.tone === 'success' ? (
            <CircleCheck aria-hidden className="size-4 shrink-0 text-[#30d158]" />
          ) : (
            <Info aria-hidden className="size-4 shrink-0 text-[#64d2ff]" />
          )}
          <span className="min-w-0">{item.message}</span>
          <button
            type="button"
            aria-label={t('toast.dismiss')}
            className="grid size-6 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => dismissToast(item.id)}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </section>
  );
}
