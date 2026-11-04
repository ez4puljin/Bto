import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { tillAddress } from '../address';
import { BrandMark, CenteredScreen, ErrorScreen, LoadingScreen } from '../components/layout';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { kioskKeys } from '../queries';
import { PairingScreen } from './pairing-screen';

/**
 * ADR-0138: a start page that still holds a device token (paired with a code before the POS had
 * addresses): the token moves to its POS's own keys, then the list shows.
 */
export function StartAdopt({ deviceToken }: { deviceToken: string }) {
  const { client, credentials } = useKiosk();
  const problemText = useProblemText();
  const device = useQuery({
    queryKey: ['kiosk', 'start-device', deviceToken],
    queryFn: ({ signal }) => client.device(signal),
    retry: false,
  });
  const code = device.data?.till.code;
  useEffect(() => {
    if (code) credentials.adopt(code, deviceToken);
  }, [code, credentials, deviceToken]);
  // A token the edge no longer knows sends the page back by itself (the client forgets it).
  if (device.isError) {
    return (
      <ErrorScreen message={problemText(device.error)} onRetry={() => void device.refetch()} />
    );
  }
  return <LoadingScreen />;
}

/**
 * ADR-0138: the kiosk's start page (`…:7400`): the edge's active POS; a click opens the POS at its
 * own address (`…:7400/K1`), which binds this browser without a code. With no POS to offer (or on
 * request) the one-time pairing code is asked as before.
 */
export function TillChooser({ onPaired }: { onPaired: () => void }) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const [withCode, setWithCode] = useState(false);
  const tills = useQuery({
    queryKey: kioskKeys.tills,
    queryFn: ({ signal }) => client.tills(signal),
    retry: false,
  });
  if (tills.isPending) return <LoadingScreen />;
  const choices = tills.data ?? [];
  if (withCode || choices.length === 0) return <PairingScreen onPaired={onPaired} />;

  return (
    <CenteredScreen>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <BrandMark className="size-12 text-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('posKiosk.choose.title')}</h1>
            <p className="text-[0.8125rem] text-muted-foreground">{t('posKiosk.choose.hint')}</p>
          </div>
        </div>
        <nav aria-label={t('posKiosk.choose.title')}>
          <ul className="flex flex-col gap-2">
            {choices.map((till) => (
              <li key={till.code}>
                <a
                  href={tillAddress(till.code, window.location)}
                  className="flex h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 text-base font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Monitor aria-hidden className="size-5 text-muted-foreground" />
                  <span className="font-mono">{till.code}</span>
                  <span className="min-w-0 flex-1 truncate">{till.name}</span>
                  <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Button variant="ghost" className="w-full" onClick={() => setWithCode(true)}>
          {t('posKiosk.choose.withCode')}
        </Button>
      </div>
    </CenteredScreen>
  );
}
