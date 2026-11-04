import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EdgeSession } from '@tugeel/shared/pos';
import { LoaderCircle, LogOut } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { KioskHeader } from '../components/kiosk-header';
import { KioskAlert } from '../components/layout';
import { useCredentials, useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { kioskKeys } from '../queries';

/**
 * No shift is open at this POS: one opens by itself with no opening cash (owner 2026-11-04: «Ээлж
 * нээх болон эхний бэлэн мөнгө хэрэггүй. Шууд ажиллахад болно»), and the sale screen follows. The
 * shift still carries the day's money to the books and is closed with the cash count.
 */
export function ShiftOpenScreen(props: { session: EdgeSession; onSignOut: () => void }) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const open = useMutation({
    mutationFn: () => client.openShift({ openingFloat: '0' }),
    onSuccess: (shift) => {
      queryClient.setQueryData<EdgeSession>(kioskKeys.session(epoch), (session) =>
        session ? { ...session, shift } : session,
      );
      void queryClient.invalidateQueries({ queryKey: kioskKeys.session(epoch) });
    },
  });
  const { mutate, isIdle } = open;
  useEffect(() => {
    if (isIdle) mutate();
  }, [isIdle, mutate]);

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <KioskHeader
        session={props.session}
        actions={
          <Button variant="outline" size="lg" onClick={props.onSignOut}>
            <LogOut />
            {t('posKiosk.menu.logout')}
          </Button>
        }
      />
      <main className="flex flex-1 items-center justify-center p-4">
        {open.isError ? (
          <div className="w-full max-w-md space-y-4">
            <KioskAlert>{problemText(open.error)}</KioskAlert>
            <Button size="lg" className="h-12 w-full text-base" onClick={() => open.mutate()}>
              {t('posKiosk.retry')}
            </Button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-base text-muted-foreground">
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
            {t('posKiosk.shiftOpen.opening')}
          </p>
        )}
      </main>
    </div>
  );
}
