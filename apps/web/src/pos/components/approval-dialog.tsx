import { type EdgeApproval, POS_LIMITS, type VoidReason } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatQty } from '@/lib/money';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { useSupervisors } from '../queries';
import { KioskAlert } from './layout';

/** What a supervisor is asked to approve: a void (ADR-0104), a return, an e-Barimt step (ADR-0065). */
export interface ApprovalRequest {
  kind: VoidReason | 'RETURN' | 'EBARIMT_ISSUED' | 'EBARIMT_RETRY' | 'EBARIMT_SEND';
  items: { name: string; qty: string; uomName: string }[];
  /** Sends the approval; a refusal (a wrong PIN) stays in the dialog. */
  run: (approval: EdgeApproval) => Promise<void>;
}

const SHOWN_ITEMS = 4;

/**
 * A supervisor's approval at the till (ADR-0104): the supervisor picks their name and types the
 * six-digit PIN; the edge checks it offline like a sign-in (five wrong ones lock for a minute).
 */
export function ApprovalDialog(props: {
  request: ApprovalRequest | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const { request } = props;
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5 text-primary" />
            {request ? t(`posKiosk.approval.titles.${request.kind}`) : null}
          </DialogTitle>
          <DialogDescription>{t('posKiosk.approval.description')}</DialogDescription>
        </DialogHeader>
        {request ? <ApprovalForm request={request} onCancel={props.onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalForm({
  request,
  onCancel,
}: {
  request: ApprovalRequest;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const supervisors = useSupervisors(true);
  const [chosen, setChosen] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pinInput = useRef<HTMLInputElement>(null);
  const list = supervisors.data ?? [];
  const only = list.length === 1 ? list[0] : undefined;
  const supervisorId = chosen ?? only?.userId ?? null;

  useEffect(() => {
    if (supervisorId !== null) pinInput.current?.focus();
  }, [supervisorId]);

  const submit = async () => {
    if (supervisorId === null || pin.length !== POS_LIMITS.pinLength || pending) return;
    setPending(true);
    setError(null);
    try {
      await request.run({ supervisorUserId: supervisorId, pin });
    } catch (caught) {
      setError(problemText(caught));
      setPin('');
      pinInput.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ul
        className={cn(
          'space-y-1 rounded-lg bg-muted px-3 py-2 text-[15px]',
          request.items.length === 0 && 'hidden',
        )}
      >
        {request.items.slice(0, SHOWN_ITEMS).map((item, index) => (
          <li key={index} className="truncate">
            {t('posKiosk.approval.item', {
              name: item.name,
              qty: formatQty(item.qty),
              uom: item.uomName,
            })}
          </li>
        ))}
        {request.items.length > SHOWN_ITEMS ? (
          <li className="text-muted-foreground">
            {t('posKiosk.approval.more', { count: request.items.length - SHOWN_ITEMS })}
          </li>
        ) : null}
      </ul>
      {supervisors.isError ? <KioskAlert>{problemText(supervisors.error)}</KioskAlert> : null}
      {supervisors.isSuccess && list.length === 0 ? (
        <KioskAlert>{t('posKiosk.approval.noSupervisors')}</KioskAlert>
      ) : null}
      {list.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('posKiosk.approval.supervisor')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {list.map((supervisor) => (
              <Button
                key={supervisor.userId}
                type="button"
                variant={supervisorId === supervisor.userId ? 'default' : 'outline'}
                aria-pressed={supervisorId === supervisor.userId}
                className="h-11 justify-start truncate"
                onClick={() => setChosen(supervisor.userId)}
              >
                {supervisor.fullName}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : only ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t('posKiosk.approval.supervisor')}: </span>
          <span className="font-medium">{only.fullName}</span>
        </p>
      ) : null}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t('posKiosk.approval.pin')}</span>
        <Input
          ref={pinInput}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={POS_LIMITS.pinLength}
          disabled={supervisorId === null}
          className={cn('h-12 text-center font-mono text-2xl tracking-[0.5em] md:text-2xl')}
          value={pin}
          onChange={(event) =>
            setPin(event.target.value.replace(/\D/g, '').slice(0, POS_LIMITS.pinLength))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') return;
            typeDigits(event, pin, (next) => setPin(next.slice(0, POS_LIMITS.pinLength)));
          }}
        />
      </label>
      {error ? <KioskAlert>{error}</KioskAlert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          className="h-11"
          disabled={supervisorId === null || pin.length !== POS_LIMITS.pinLength || pending}
        >
          {t('posKiosk.approval.approve')}
        </Button>
      </DialogFooter>
    </form>
  );
}
