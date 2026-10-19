import { zodResolver } from '@hookform/resolvers/zod';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { KeyRound, Lock, LockOpen, Smartphone, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldList } from '@/components/detail';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { OneTimeCodeDialog } from '@/features/pos/one-time-code-dialog';
import {
  type CustomerAppAccount,
  type CustomerAppCode,
  useCustomerAppAccount,
  useCustomerAppMutations,
} from './api';
import { localPhone, phoneInput } from './phone';

const when = (iso: string) => formatUbDateTime(Date.parse(iso));
const later = (iso: string | null): iso is string => iso !== null && Date.parse(iso) > Date.now();

/**
 * «Апп» on the customer's page (ADR-0079 #11): the store's sign-in phone for «Bto300», whether the
 * app is open, a password set or a code awaited, the last sign-in, a live code's end and a lock.
 * People with `partners.customer_app.manage` link or change the phone, issue a one-time code
 * (shown once, read out to the store) and close or reopen the app; the others only read.
 */
export function CustomerAppCard({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  const titleId = useId();
  const canRead = useHasPermission('partners.customers.read');
  const canManage = useHasPermission('partners.customer_app.manage');
  const account = useCustomerAppAccount(customerId, canRead);
  const mutations = useCustomerAppMutations(customerId);
  const action = useAction();
  const [asking, setAsking] = useState<'code' | 'disable' | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [code, setCode] = useState<CustomerAppCode | null>(null);
  if (!canRead) return null;
  const current = account.data ?? null;

  const ask = (what: 'code' | 'disable') => {
    action.clear();
    setAsking(what);
  };
  const confirm = () => {
    if (asking === 'code') {
      void action.run(async () => {
        const issued = await mutations.issueCode.mutateAsync();
        setAsking(null);
        setCode(issued);
      });
    } else if (asking === 'disable') {
      void action.run(async () => {
        await mutations.disable.mutateAsync();
        setAsking(null);
        toast.success(t('partners.app.disabled'));
      });
    }
  };
  const enable = () =>
    void action.run(async () => {
      await mutations.enable.mutateAsync();
      toast.success(t('partners.app.enabled'));
    });

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t('partners.app.title')}</CardTitle>
        {canManage && account.isSuccess && current === null ? (
          <CardAction>
            <Button size="sm" variant="secondary" onClick={() => setEditingPhone(true)}>
              <Smartphone />
              {t('partners.app.link')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(account.error)} />
        {account.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {account.isSuccess && current === null ? (
          <p className="text-sm text-muted-foreground">{t('partners.app.empty')}</p>
        ) : null}
        {current ? <AccountFacts account={current} /> : null}
        {/* Dialogs show their own refusals; the card shows those of «Аппыг нээх». */}
        <ProblemAlert problem={asking ? null : action.problem} />
        {canManage && current ? (
          <div className="flex flex-wrap gap-2">
            {current.status === 'ACTIVE' ? (
              <Button size="sm" variant="secondary" onClick={() => ask('code')}>
                <KeyRound />
                {t('partners.app.issueCode')}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setEditingPhone(true)}>
              <Smartphone />
              {t('partners.app.changePhone')}
            </Button>
            {current.status === 'ACTIVE' ? (
              <Button size="sm" variant="outline" onClick={() => ask('disable')}>
                <Lock />
                {t('partners.app.disable')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={mutations.enable.isPending}
                onClick={enable}
              >
                <LockOpen />
                {t('partners.app.enable')}
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
      {editingPhone ? (
        <PhoneDialog
          account={current}
          onSave={(phone) => mutations.link.mutateAsync(phone)}
          onClose={() => setEditingPhone(false)}
        />
      ) : null}
      <ConfirmDialog
        open={asking === 'code'}
        variant="default"
        title={t('partners.app.issueCodeTitle')}
        description={t('partners.app.issueCodeDescription')}
        confirmLabel={t('partners.app.issueCode')}
        pending={mutations.issueCode.isPending}
        problem={action.problem}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'disable'}
        title={t('partners.app.disableTitle')}
        description={t('partners.app.disableDescription')}
        confirmLabel={t('partners.app.disable')}
        pending={mutations.disable.isPending}
        problem={action.problem}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
      <OneTimeCodeDialog
        open={code !== null}
        title={t('partners.app.codeTitle')}
        description={t('partners.app.codeDescription', {
          time: code ? when(code.expiresAt) : '',
        })}
        code={code?.code ?? ''}
        onClose={() => setCode(null)}
      />
    </Card>
  );
}

/** The account read first: phone, open or closed, password or code, last sign-in, a lock. */
function AccountFacts({ account }: { account: CustomerAppAccount }) {
  const { t } = useTranslation();
  return (
    <FieldList
      items={[
        {
          label: t('partners.app.phone'),
          value: <span className="font-mono">{localPhone(account.phone)}</span>,
        },
        {
          label: t('partners.app.status'),
          value: (
            <Badge variant={account.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {t(`partners.app.statuses.${account.status}`)}
            </Badge>
          ),
        },
        {
          label: t('partners.app.password'),
          value: account.passwordSet ? (
            t('partners.app.passwordSet')
          ) : (
            <Badge variant="warning">{t('partners.app.waitingForCode')}</Badge>
          ),
        },
        ...(later(account.codeExpiresAt)
          ? [
              {
                label: t('partners.app.code'),
                value: t('partners.app.until', { time: when(account.codeExpiresAt) }),
              },
            ]
          : []),
        {
          label: t('partners.app.lastSignIn'),
          value: account.lastSignInAt ? (
            <span className="font-mono">{when(account.lastSignInAt)}</span>
          ) : (
            t('partners.app.neverSignedIn')
          ),
        },
        ...(later(account.lockedUntil)
          ? [
              {
                label: t('partners.app.locked'),
                value: (
                  <Badge variant="destructive">
                    {t('partners.app.until', { time: when(account.lockedUntil) })}
                  </Badge>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .refine((value) => normalizeMnPhone(value) !== null, 'validation.phone'),
});
type PhoneValues = z.infer<typeof phoneSchema>;

/**
 * «Утас холбох» / «Утас солих»: the sign-in phone, sent in E.164. Changing it clears the password
 * and signs every phone out (said before saving); a phone of another store shows on the field.
 */
function PhoneDialog(props: {
  account: CustomerAppAccount | null;
  onSave: (phone: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useAction();
  const changing = props.account !== null;
  const form = useForm<PhoneValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: phoneInput(props.account?.phone ?? null) },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const phone = normalizeMnPhone(values.phone);
    if (!phone) return;
    const ok = await action.run(() => props.onSave(phone));
    if (ok) {
      toast.success(changing ? t('partners.app.phoneChanged') : t('partners.app.linked'));
      props.onClose();
    }
  });
  const problem = action.problem;
  const taken =
    problem?.code === 'DUPLICATE_VALUE' &&
    problem.params?.constraint === 'customer_users_phone_key';

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {changing ? t('partners.app.changeTitle') : t('partners.app.linkTitle')}
            </DialogTitle>
            <DialogDescription>{t('partners.app.linkDescription')}</DialogDescription>
          </DialogHeader>
          {changing ? (
            <Alert className="border-transparent bg-warning-soft shadow-none!">
              <TriangleAlert aria-hidden className="text-warning" />
              <AlertDescription className="text-warning">
                {t('partners.app.changeWarning')}
              </AlertDescription>
            </Alert>
          ) : null}
          <ProblemAlert problem={taken ? null : problem} />
          <FormField
            label={t('partners.app.phone')}
            htmlFor="customer-app-phone"
            hint={t('partners.app.phoneHint')}
            error={taken ? 'validation.phoneTaken' : errors.phone?.message}
          >
            <Input
              id="customer-app-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="font-mono sm:w-44"
              {...form.register('phone', { onChange: () => action.clear() })}
            />
          </FormField>
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
