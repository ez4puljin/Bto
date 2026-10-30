import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EdgeSession } from '@tugeel/shared/pos';
import { LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseMoney, wireMoney } from '../amounts';
import { KioskHeader } from '../components/kiosk-header';
import { KioskAlert } from '../components/layout';
import { useCredentials, useKiosk } from '../kiosk-context';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { kioskKeys } from '../queries';

/** No shift is open at this till: the cashier counts the drawer's change and opens one. */
export function ShiftOpenScreen(props: { session: EdgeSession; onSignOut: () => void }) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [openingFloat, setOpeningFloat] = useState('');
  const [tried, setTried] = useState(false);
  const amount = parseMoney(openingFloat);
  const open = useMutation({
    mutationFn: (value: string) => client.openShift({ openingFloat: value }),
    onSuccess: (shift) => {
      queryClient.setQueryData<EdgeSession>(kioskKeys.session(epoch), (session) =>
        session ? { ...session, shift } : session,
      );
      void queryClient.invalidateQueries({ queryKey: kioskKeys.session(epoch) });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (amount === null || open.isPending) return;
    open.mutate(wireMoney(amount));
  };

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
        <form
          className="w-full max-w-md space-y-5 rounded-2xl bg-card p-6 shadow-dialog ring-1 ring-black/[0.06] sm:p-8"
          onSubmit={submit}
          noValidate
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('posKiosk.shiftOpen.title')}
            </h1>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('posKiosk.shiftOpen.hint', { date: props.session.businessDate })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift-float" className="text-[0.9375rem]">
              {t('pos.fields.openingFloat')}
            </Label>
            <Input
              id="shift-float"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              className="h-14 text-right font-mono text-2xl md:text-2xl"
              value={openingFloat}
              aria-invalid={tried && amount === null}
              aria-describedby={tried && amount === null ? 'shift-float-error' : undefined}
              onChange={(event) => setOpeningFloat(event.target.value)}
              onKeyDown={(event) => typeDigits(event, openingFloat, setOpeningFloat)}
            />
            {tried && amount === null ? (
              <p id="shift-float-error" className="text-sm text-destructive">
                {t('validation.money')}
              </p>
            ) : null}
          </div>
          {open.isError ? <KioskAlert>{problemText(open.error)}</KioskAlert> : null}
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full text-base"
            disabled={open.isPending}
          >
            {t('posKiosk.shiftOpen.submit')}
          </Button>
        </form>
      </main>
    </div>
  );
}
