import { KeyRound, LockOpen, Plus, UserRoundX, UserRoundCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUsers } from '@/features/identity/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { type Cashier, useCashiers, usePosMutations } from './api';
import { ActiveBadge } from './badges';

/** «Кассчин» (ADR-0063 #6): who works the tills and their PINs, set by the admin, never shown. */
export function PosCashiersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const cashiers = useCashiers();
  const [adding, setAdding] = useCreateParam();
  const [editing, setEditing] = useState<Cashier | null>(null);
  const mutations = usePosMutations();
  const action = useAction();
  const now = Date.now();

  const toggle = (cashier: Cashier) => {
    void action.run(async () => {
      await mutations.setCashierStatus.mutateAsync({
        userId: cashier.userId,
        status: cashier.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      toast.success(t('pos.cashiers.statusChanged'));
    });
  };
  const unlock = (cashier: Cashier) => {
    void action.run(async () => {
      await mutations.unlockCashier.mutateAsync(cashier.userId);
      toast.success(t('pos.cashiers.unlocked'));
    });
  };

  return (
    <div>
      <PageHeader
        title={t('pos.cashiers.title')}
        description={t('pos.cashiers.description')}
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              {t('pos.actions.newCashier')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(cashiers.error) ?? action.problem} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.cashier')}</TableHead>
              <TableHead>{t('pos.fields.user')}</TableHead>
              <TableHead>{t('pos.fields.status')}</TableHead>
              <TableHead>{t('pos.fields.pinSetAt')}</TableHead>
              <TableHead>{t('pos.fields.pinSetBy')}</TableHead>
              <SpacerHead />
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashiers.isPending ? <SkeletonRows columns={7} /> : null}
            {(cashiers.data ?? []).map((cashier) => {
              const locked = cashier.lockedUntil !== null && Date.parse(cashier.lockedUntil) > now;
              return (
                <TableRow key={cashier.userId}>
                  <TableCell className="font-medium">{cashier.fullName}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {cashier.username}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <ActiveBadge status={cashier.status} />
                      {cashier.userStatus === 'DISABLED' ? (
                        <Badge variant="destructive">{t('pos.cashiers.userDisabled')}</Badge>
                      ) : null}
                      {locked && cashier.lockedUntil ? (
                        <Badge variant="warning">
                          {t('pos.cashiers.lockedUntil', {
                            time: formatUbDateTime(Date.parse(cashier.lockedUntil)),
                          })}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(cashier.pinSetAt))}
                  </TableCell>
                  <TableCell>
                    {cashier.pinSetByName ?? (
                      <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                    )}
                  </TableCell>
                  <SpacerCell />
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={`${t('pos.actions.setPin')}: ${cashier.fullName}`}
                          icon={KeyRound}
                          onClick={() => setEditing(cashier)}
                        />
                        <RowAction
                          label={`${cashier.status === 'ACTIVE' ? t('pos.actions.deactivate') : t('pos.actions.activate')}: ${cashier.fullName}`}
                          icon={cashier.status === 'ACTIVE' ? UserRoundX : UserRoundCheck}
                          onClick={() => toggle(cashier)}
                        />
                        <RowAction
                          label={`${t('pos.actions.unlock')}: ${cashier.fullName}`}
                          icon={LockOpen}
                          disabled={!locked}
                          onClick={() => unlock(cashier)}
                        />
                      </>
                    ) : null}
                  </RowActions>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!cashiers.isPending && (cashiers.data ?? []).length === 0 ? (
          <EmptyState icon={KeyRound} title={t('pos.cashiers.empty')} />
        ) : null}
      </ListCard>
      <PinDialog
        open={adding || editing !== null}
        cashier={editing}
        onClose={() => {
          if (editing) setEditing(null);
          else setAdding(false);
        }}
      />
    </div>
  );
}

function PinDialog({
  open,
  cashier,
  onClose,
}: {
  open: boolean;
  cashier: Cashier | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <PinForm cashier={cashier} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function PinForm({ cashier, onClose }: { cashier: Cashier | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const users = useUsers(search);
  const mutations = usePosMutations();
  const action = useAction();
  const [userId, setUserId] = useState<number | null>(cashier?.userId ?? null);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [checked, setChecked] = useState(false);
  const pinOk = /^[0-9]{6}$/.test(pin);
  const same = pin === again;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (userId === null || !pinOk || !same) return;
    void action
      .run(async () => {
        await mutations.setPin.mutateAsync({ userId, pin });
        toast.success(t('pos.cashiers.pinSet'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>
          {cashier
            ? t('pos.cashiers.pinTitle', { name: cashier.fullName })
            : t('pos.cashiers.dialogTitle')}
        </DialogTitle>
        <DialogDescription>{t('pos.cashiers.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {cashier ? null : (
          <>
            <FormField label={t('common.search')} htmlFor="cashier-search">
              <Input
                id="cashier-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>
            <FormField
              label={t('pos.fields.user')}
              htmlFor="cashier-user"
              error={checked && userId === null ? 'validation.required' : undefined}
            >
              <NativeSelect
                id="cashier-user"
                value={userId ?? ''}
                onChange={(event) => setUserId(Number.parseInt(event.target.value, 10) || null)}
              >
                <option value="">{t('pos.cashiers.chooseUser')}</option>
                {(users.data?.pages.flatMap((page) => page.data) ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} · {user.username}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('pos.fields.pin')}
            htmlFor="cashier-pin"
            error={checked && !pinOk ? 'validation.pin' : undefined}
          >
            <Input
              id="cashier-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono tracking-widest"
              value={pin}
              maxLength={6}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
          </FormField>
          <FormField
            label={t('pos.fields.pinAgain')}
            htmlFor="cashier-pin-again"
            error={checked && pinOk && !same ? 'validation.pinMismatch' : undefined}
          >
            <Input
              id="cashier-pin-again"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono tracking-widest"
              value={again}
              maxLength={6}
              onChange={(event) => setAgain(event.target.value.replace(/\D/g, ''))}
            />
          </FormField>
        </div>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={mutations.setPin.isPending} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}
