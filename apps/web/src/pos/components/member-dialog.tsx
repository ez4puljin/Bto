import { useMutation } from '@tanstack/react-query';
import type { EdgeMember } from '@tugeel/shared/pos';
import { Gift, Search, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
import { formatMnt, formatTugrik } from '@/lib/money';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { KioskAlert } from './layout';

/**
 * «Бонус карт (F3)» (ADR-0112): the cashier types the customer's phone, sees the member's name,
 * tier and points, and attaches the card to the sale; the sale earns points on what is paid, and
 * the payment offers «Бонус оноо» with the member's own PIN.
 */
export function MemberDialog(props: {
  open: boolean;
  member: EdgeMember | null;
  onAttach: (member: EdgeMember | null) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" className="gap-3" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift aria-hidden className="size-5 text-primary" />
            {t('posKiosk.loyalty.title')}
          </DialogTitle>
          <DialogDescription>{t('posKiosk.loyalty.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <MemberPanel {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MemberPanel(props: {
  member: EdgeMember | null;
  onAttach: (member: EdgeMember | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [phone, setPhone] = useState('');
  const lookup = useMutation({ mutationFn: (typed: string) => client.member(typed) });
  const found = lookup.data ?? props.member;
  const blocked = found?.status === 'BLOCKED';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length >= 8) lookup.mutate(digits);
  };

  return (
    <div className="grid gap-3">
      <form className="flex gap-2" onSubmit={submit} noValidate>
        <Input
          autoFocus
          aria-label={t('posKiosk.loyalty.phone')}
          placeholder={t('posKiosk.loyalty.phonePlaceholder')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          className="h-12 flex-1 font-mono text-xl md:text-xl"
          value={phone}
          onChange={(event) => setPhone(event.target.value.replace(/[^0-9 ]/g, ''))}
        />
        <Button type="submit" className="h-12" disabled={lookup.isPending}>
          <Search />
          {t('posKiosk.loyalty.find')}
        </Button>
      </form>
      {lookup.isError ? <KioskAlert>{problemText(lookup.error)}</KioskAlert> : null}
      {found ? (
        <section
          aria-label={t('posKiosk.loyalty.found')}
          className="space-y-1 rounded-xl bg-canvas p-4 text-[0.9375rem]"
        >
          <p className="text-lg font-semibold">{found.name}</p>
          <p className="font-mono text-muted-foreground">{found.phone}</p>
          {blocked ? (
            <KioskAlert>{t('posKiosk.loyalty.blocked')}</KioskAlert>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 pt-2">
              <dt className="text-muted-foreground">{t('posKiosk.loyalty.balance')}</dt>
              <dd data-testid="member-balance" className="text-right font-mono font-semibold">
                {t('posKiosk.loyalty.points', { points: formatMnt(found.balance) })}
              </dd>
              <dt className="text-muted-foreground">{t('posKiosk.loyalty.tierLabel')}</dt>
              <dd className="text-right">
                {found.tier
                  ? t('posKiosk.loyalty.tier', {
                      name: found.tier.name,
                      percent: formatMnt(found.tier.percent),
                    })
                  : t('posKiosk.loyalty.noTier')}
              </dd>
              {found.nextTier ? (
                <>
                  <dt className="text-muted-foreground">{t('posKiosk.loyalty.nextTier')}</dt>
                  <dd className="text-right">
                    {t('posKiosk.loyalty.nextTierLeft', {
                      name: found.nextTier.name,
                      left: formatTugrik(found.nextTier.left),
                    })}
                  </dd>
                </>
              ) : null}
            </dl>
          )}
        </section>
      ) : null}
      <DialogFooter>
        {props.member ? (
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => {
              props.onAttach(null);
              props.onClose();
            }}
          >
            <X />
            {t('posKiosk.loyalty.detach')}
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-12"
          disabled={!lookup.data || blocked}
          onClick={() => {
            if (lookup.data) props.onAttach(lookup.data);
            props.onClose();
          }}
        >
          <Gift />
          {t('posKiosk.loyalty.attach')}
        </Button>
      </DialogFooter>
    </div>
  );
}
