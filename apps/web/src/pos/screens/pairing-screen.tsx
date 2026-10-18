import { useMutation } from '@tanstack/react-query';
import { type EdgePairRequest, isTillCode, normalizeTillCode } from '@tugeel/shared/pos';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandMark, CenteredScreen, KioskAlert } from '../components/layout';
import { useCredentials, useKiosk } from '../kiosk-context';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';

const PAIRING_CODE = /^[0-9]{6}$/;

/**
 * The first screen of a new till PC: the till's code and the one-time code the admin issued in
 * «Супермаркет → Касс». The edge answers with the device token this browser keeps.
 */
export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const { t } = useTranslation();
  const { client, credentials } = useKiosk();
  const { notice } = useCredentials();
  const problemText = useProblemText();
  const [tillCode, setTillCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [tried, setTried] = useState(false);
  const pair = useMutation({
    mutationFn: (body: EdgePairRequest) => client.pair(body),
    onSuccess: (response) => {
      onPaired();
      credentials.paired(response.deviceToken);
    },
  });
  const code = normalizeTillCode(tillCode);
  const tillOk = isTillCode(code);
  const pairingOk = PAIRING_CODE.test(pairingCode.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!tillOk || !pairingOk || pair.isPending) return;
    credentials.clearNotice();
    pair.mutate({ tillCode: code, pairingCode: pairingCode.trim() });
  };

  return (
    <CenteredScreen>
      <form className="space-y-5" onSubmit={submit} noValidate>
        <div className="flex items-center gap-3">
          <BrandMark className="size-12 text-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('posKiosk.pair.title')}</h1>
            <p className="text-[13px] text-muted-foreground">{t('posKiosk.pair.hint')}</p>
          </div>
        </div>
        {notice === 'POS_DEVICE_UNKNOWN' ? (
          <KioskAlert tone="warning">{t('errors.POS_DEVICE_UNKNOWN')}</KioskAlert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="pair-till" className="text-[15px]">
            {t('posKiosk.pair.tillCode')}
          </Label>
          <Input
            id="pair-till"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-12 font-mono text-lg uppercase md:text-lg"
            placeholder={t('posKiosk.pair.tillCodePlaceholder')}
            value={tillCode}
            aria-invalid={tried && !tillOk}
            aria-describedby={tried && !tillOk ? 'pair-till-error' : undefined}
            onChange={(event) => setTillCode(event.target.value)}
            onKeyDown={(event) => typeDigits(event, tillCode, setTillCode)}
          />
          {tried && !tillOk ? (
            <p id="pair-till-error" className="text-sm text-destructive">
              {t('posKiosk.pair.tillCodeInvalid')}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pair-code" className="text-[15px]">
            {t('posKiosk.pair.pairingCode')}
          </Label>
          <Input
            id="pair-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="h-12 font-mono text-lg tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal md:text-lg"
            placeholder={t('posKiosk.pair.pairingCodePlaceholder')}
            value={pairingCode}
            aria-invalid={tried && !pairingOk}
            aria-describedby={tried && !pairingOk ? 'pair-code-error' : undefined}
            onChange={(event) => setPairingCode(event.target.value)}
            onKeyDown={(event) => typeDigits(event, pairingCode, setPairingCode)}
          />
          {tried && !pairingOk ? (
            <p id="pair-code-error" className="text-sm text-destructive">
              {t('posKiosk.pair.pairingCodeInvalid')}
            </p>
          ) : null}
        </div>
        {pair.isError ? <KioskAlert>{problemText(pair.error)}</KioskAlert> : null}
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pair.isPending}>
          {pair.isPending ? t('posKiosk.pair.pending') : t('posKiosk.pair.submit')}
        </Button>
      </form>
    </CenteredScreen>
  );
}
