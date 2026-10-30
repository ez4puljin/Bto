import { useMutation } from '@tanstack/react-query';
import { POS_LIMITS } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { Delete, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  BrandMark,
  CenteredScreen,
  ErrorScreen,
  KioskAlert,
  LoadingScreen,
} from '../components/layout';
import { useCredentials, useKiosk } from '../kiosk-context';
import { digitOf, keepFocus } from '../keys';
import { useProblemText } from '../messages';
import { useDevice } from '../queries';

const PIN_LENGTH = POS_LIMITS.pinLength;
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

interface Cashier {
  userId: number;
  fullName: string;
}

/**
 * The cashier's sign-in: the till's cashiers as large name buttons, then a six-digit PIN typed on
 * the pad or the keyboard. An expired session comes back here on the same cashier's PIN.
 */
export function LoginScreen({ onNewCashier }: { onNewCashier: () => void }) {
  const { t } = useTranslation();
  const device = useDevice();
  const { notice, lastCashierId } = useCredentials();
  const problemText = useProblemText();
  const [chosen, setChosen] = useState<number | null>(lastCashierId);

  if (device.isPending) return <LoadingScreen />;
  if (device.isError) {
    return (
      <ErrorScreen message={problemText(device.error)} onRetry={() => void device.refetch()} />
    );
  }
  const { till, cashiers, companyName } = device.data;
  const cashier = cashiers.find((entry) => entry.userId === chosen) ?? null;

  return (
    <CenteredScreen className={cashier ? 'max-w-md' : 'max-w-3xl'}>
      <div className="mb-5 flex items-center gap-3">
        <BrandMark className="size-12 text-xl" />
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold">
            {companyName ?? t('brand.company')}
          </p>
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            {t('posKiosk.header.till', { code: till.code, name: till.name })}
          </p>
        </div>
      </div>
      {notice === 'POS_SESSION_EXPIRED' ? (
        <KioskAlert tone="warning" className="mb-4">
          {t('errors.POS_SESSION_EXPIRED')}
        </KioskAlert>
      ) : null}
      {cashier ? (
        <PinEntry
          key={cashier.userId}
          cashier={cashier}
          canChange={cashiers.length > 1}
          onBack={() => setChosen(null)}
          onNewCashier={onNewCashier}
        />
      ) : (
        <CashierPicker cashiers={cashiers} onPick={setChosen} />
      )}
    </CenteredScreen>
  );
}

function CashierPicker(props: { cashiers: readonly Cashier[]; onPick: (userId: number) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="login-title" className="space-y-4">
      <div>
        <h1 id="login-title" className="text-2xl font-semibold tracking-tight">
          {t('posKiosk.login.title')}
        </h1>
        <p className="text-[0.8125rem] text-muted-foreground">{t('posKiosk.login.hint')}</p>
      </div>
      {props.cashiers.length === 0 ? (
        <KioskAlert tone="info">{t('posKiosk.login.noCashiers')}</KioskAlert>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {props.cashiers.map((cashier) => (
            <li key={cashier.userId}>
              <Button
                variant="outline"
                className="h-20 w-full justify-start gap-3 px-4 text-left text-base"
                onClick={() => props.onPick(cashier.userId)}
              >
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-base font-semibold text-secondary-foreground"
                >
                  {cashier.fullName.charAt(0)}
                </span>
                <span className="line-clamp-2 leading-snug font-semibold whitespace-normal">
                  {cashier.fullName}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PinEntry(props: {
  cashier: Cashier;
  canChange: boolean;
  onBack: () => void;
  onNewCashier: () => void;
}) {
  const { t } = useTranslation();
  const { client, credentials } = useKiosk();
  const { lastCashierId } = useCredentials();
  const problemText = useProblemText();
  const [pin, setPin] = useState('');
  const current = useRef('');
  const { cashier } = props;
  const login = useMutation({
    mutationFn: (value: string) => client.login({ userId: cashier.userId, pin: value }),
    onSuccess: (response) => {
      if (lastCashierId !== response.cashier.userId) props.onNewCashier();
      credentials.signedIn(response.token, response.cashier.userId);
    },
    onError: () => {
      current.current = '';
      setPin('');
    },
  });

  const update = (value: string) => {
    current.current = value;
    setPin(value);
  };
  const press = (digit: string) => {
    if (login.isPending || current.current.length >= PIN_LENGTH) return;
    if (login.isError) login.reset();
    const next = `${current.current}${digit}`;
    update(next);
    if (next.length === PIN_LENGTH) login.mutate(next);
  };
  const backspace = () => {
    if (!login.isPending) update(current.current.slice(0, -1));
  };
  const submit = () => {
    if (!login.isPending && current.current.length === PIN_LENGTH) login.mutate(current.current);
  };

  const handlers = useRef({ press, backspace, submit, back: props.onBack });
  useEffect(() => {
    handlers.current = { press, backspace, submit, back: props.onBack };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const digit = digitOf(event);
      if (digit !== null) {
        event.preventDefault();
        handlers.current.press(digit);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handlers.current.backspace();
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        handlers.current.submit();
      } else if (event.key === 'Escape') {
        handlers.current.back();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <section aria-labelledby="pin-title" className="space-y-5">
      <div className="text-center">
        <span
          aria-hidden
          className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        >
          <UserRound className="size-7" />
        </span>
        <h1 id="pin-title" className="text-xl font-semibold tracking-tight">
          {cashier.fullName}
        </h1>
        <p className="text-[0.8125rem] text-muted-foreground">{t('posKiosk.login.pinHint')}</p>
      </div>
      <div
        role="img"
        aria-label={t('posKiosk.login.pinDots', { count: pin.length, total: PIN_LENGTH })}
        className="flex justify-center gap-3"
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              'size-4 rounded-full border-2 border-primary transition-colors',
              index < pin.length ? 'bg-primary' : 'bg-transparent',
            )}
          />
        ))}
      </div>
      {login.isError ? <KioskAlert>{problemText(login.error)}</KioskAlert> : null}
      <div
        role="group"
        aria-label={t('posKiosk.login.pinPad')}
        className="mx-auto grid max-w-xs grid-cols-3 gap-3"
      >
        {PAD.map((digit) => (
          <PadButton key={digit} onPress={() => press(digit)} disabled={login.isPending}>
            {digit}
          </PadButton>
        ))}
        <PadButton
          label={t('posKiosk.login.clear')}
          onPress={() => update('')}
          disabled={login.isPending}
          className="text-[0.9375rem]"
        >
          {t('posKiosk.login.clearShort')}
        </PadButton>
        <PadButton onPress={() => press('0')} disabled={login.isPending}>
          {'0'}
        </PadButton>
        <PadButton
          label={t('posKiosk.login.backspace')}
          onPress={backspace}
          disabled={login.isPending}
        >
          <Delete className="size-6" />
        </PadButton>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={login.isPending || pin.length < PIN_LENGTH}
          onClick={submit}
        >
          {login.isPending ? t('posKiosk.login.pending') : t('posKiosk.login.submit')}
        </Button>
        {props.canChange ? (
          <Button variant="ghost" className="h-11 w-full" onClick={props.onBack}>
            {t('posKiosk.login.changeCashier')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function PadButton(props: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onMouseDown={keepFocus}
      onClick={props.onPress}
      className={cn('h-14 rounded-xl font-mono text-2xl font-semibold', props.className)}
    >
      {props.children}
    </Button>
  );
}
