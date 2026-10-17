import { cn } from 'cn';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** The blue square with the first letter of «Bto», as in the admin's menu (docs/ui.md §7). */
export function BrandMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground',
        className,
      )}
    >
      {t('app.name').charAt(0)}
    </span>
  );
}

/** A whole-window screen with one card in the middle (pairing, PIN, loading). */
export function CenteredScreen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div
        className={cn(
          'w-full max-w-md rounded-2xl bg-card p-6 shadow-dialog ring-1 ring-black/[0.06] sm:p-8',
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
}

export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <p role="status" className="flex items-center gap-2 text-base text-muted-foreground">
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
        {t('common.loading')}
      </p>
    </main>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <CenteredScreen className="space-y-4 text-center">
      <KioskAlert>{message}</KioskAlert>
      <Button size="lg" className="h-12 w-full text-base" onClick={onRetry}>
        {t('posKiosk.retry')}
      </Button>
    </CenteredScreen>
  );
}

const TONES = {
  destructive: 'bg-danger-soft text-destructive',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-link',
} as const;

/** One line saying what went wrong (or what happened) next to the thing it concerns. */
export function KioskAlert({
  children,
  tone = 'destructive',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('rounded-xl px-4 py-3 text-sm font-medium', TONES[tone], className)}
    >
      {children}
    </div>
  );
}
