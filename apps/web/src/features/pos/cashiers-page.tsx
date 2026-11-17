import { KeyRound, LockOpen, Pencil, Plus, UserRoundX, UserRoundCheck } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUsers } from '@/features/identity/api';
import { localPhone } from '@/features/partners/phone';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime, formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { type Cashier, type Till, useCashiers, usePosMutations, useTills } from './api';
import { ActiveBadge } from './badges';

/**
 * The list's columns (ADR-0119): 54.75rem in all, the PIN's time to the minute, so a till PC's
 * 56rem shows every one; the status cell may hold a second badge with a time. A row's actions are
 * the page's work (the PIN, the state, the lock), so they never leave the card: an upright
 * tablet's 41rem lets who set the PIN go (46.75), then when (36.75) (ADR-0201).
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'cashier', kind: 'text', weight: 3, min: 11 },
  { key: 'user', kind: 'code', width: 9 },
  { key: 'status', kind: 'text', weight: 2, min: 10 },
  // «2026-11-15 14:05» is 141px: 10rem with its padding.
  { key: 'pinSetAt', kind: 'datetime', width: 10, drop: 2 },
  // «Тохируулсан хүн» is 8rem with its padding.
  { key: 'pinSetBy', kind: 'text', weight: 1, min: 8, drop: 1 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 3 },
];

/** «Кассчин» (ADR-0063 #6): who works the tills and their PINs, set by the admin, never shown. */
export function PosCashiersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const cashiers = useCashiers();
  const tills = useTills();
  const tillCodes = useMemo(
    () => new Map((tills.data ?? []).map((till) => [till.id, till.code])),
    [tills.data],
  );
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
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.cashier')}</TableHead>
              <TableHead>{t('pos.fields.user')}</TableHead>
              <TableHead>{t('pos.fields.status')}</TableHead>
              <TableHead>{t('pos.fields.pinSetAt')}</TableHead>
              <TableHead>{t('pos.fields.pinSetBy')}</TableHead>
              <SpacerHead />
              <TableHead />
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
                    {cashier.phone ? localPhone(cashier.phone) : t('common.none')}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <ActiveBadge status={cashier.status} />
                      {cashier.tillIds.length > 0 ? (
                        <Badge variant="outline">
                          {t('pos.cashiers.tillsBadge', {
                            codes: cashier.tillIds
                              .map((id) => tillCodes.get(id) ?? `#${id}`)
                              .join(', '),
                          })}
                        </Badge>
                      ) : null}
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
                  <TableCell className="font-mono">{formatUbMinute(cashier.pinSetAt)}</TableCell>
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
                          label={`${t('pos.actions.edit')}: ${cashier.fullName}`}
                          icon={Pencil}
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
        </ListTable>
        {!cashiers.isPending && (cashiers.data ?? []).length === 0 ? (
          <EmptyState icon={KeyRound} title={t('pos.cashiers.empty')} />
        ) : null}
      </ListCard>
      <PinDialog
        open={adding || editing !== null}
        cashier={editing}
        cashiers={cashiers.data ?? []}
        tills={tills.data ?? []}
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
  cashiers,
  tills,
  onClose,
}: {
  open: boolean;
  cashier: Cashier | null;
  cashiers: readonly Cashier[];
  tills: readonly Till[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <PinForm cashier={cashier} cashiers={cashiers} tills={tills} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

/**
 * A new cashier (a staff member found by typing their name or phone) or an existing one's tills
 * and PIN (owner 2026-11-17): the tills they work are ticked among the active ones, none ticked
 * means every till; an existing cashier's PIN changes only when a new one is typed.
 */
function PinForm({
  cashier,
  cashiers,
  tills,
  onClose,
}: {
  cashier: Cashier | null;
  cashiers: readonly Cashier[];
  tills: readonly Till[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const users = useUsers({ status: 'ACTIVE' });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = users;
  // The picker filters in the browser, so a staff larger than one page is read to its end.
  useEffect(() => {
    if (cashier === null && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [cashier, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const mutations = usePosMutations();
  const action = useAction();
  const [userId, setUserId] = useState<number | null>(cashier?.userId ?? null);
  const [tillIds, setTillIds] = useState<number[]>(cashier?.tillIds ?? []);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [checked, setChecked] = useState(false);
  const keepPin = cashier !== null && pin === '' && again === '';
  const pinOk = keepPin || /^[0-9]{6}$/.test(pin);
  const same = pin === again;
  const activeTills = tills.filter((till) => till.status === 'ACTIVE');
  const userOptions = useMemo(() => {
    const taken = new Set(cashiers.map((row) => row.userId));
    return (users.data?.pages.flatMap((page) => page.data) ?? [])
      .filter((user) => !taken.has(user.id))
      .map((user) => ({
        value: String(user.id),
        label: user.phone ? `${user.fullName} · ${localPhone(user.phone)}` : user.fullName,
        keys: user.phone ? [user.phone, localPhone(user.phone).replace(/\s/g, '')] : [],
      }));
  }, [users.data, cashiers]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (userId === null || !pinOk || !same) return;
    // A till that stopped since the dialog opened is not sent back.
    const chosen = tillIds.filter((id) => activeTills.some((till) => till.id === id));
    void action
      .run(async () => {
        if (keepPin) {
          await mutations.setCashierTills.mutateAsync({ userId, tillIds: chosen });
          toast.success(t('pos.cashiers.saved'));
        } else {
          await mutations.setPin.mutateAsync({ userId, pin, tillIds: chosen });
          toast.success(t('pos.cashiers.pinSet'));
        }
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
            ? t('pos.cashiers.editTitle', { name: cashier.fullName })
            : t('pos.cashiers.dialogTitle')}
        </DialogTitle>
        <DialogDescription>
          {cashier ? t('pos.cashiers.editDescription') : t('pos.cashiers.dialogDescription')}
        </DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {cashier ? null : (
          <FormField
            label={t('pos.fields.user')}
            htmlFor="cashier-user"
            error={checked && userId === null ? 'validation.required' : undefined}
          >
            <SearchSelect
              id="cashier-user"
              value={userId === null ? '' : String(userId)}
              options={userOptions}
              placeholder={t('pos.cashiers.chooseUser')}
              invalid={checked && userId === null}
              onChange={(value) => setUserId(Number.parseInt(value, 10) || null)}
            />
          </FormField>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm leading-none font-medium">
            {t('pos.cashiers.tills')}
          </legend>
          {activeTills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pos.cashiers.noTills')}</p>
          ) : (
            <CheckboxGroup
              name="cashier-till"
              options={activeTills.map((till) => ({
                value: till.id,
                label: `${till.code} · ${till.name}`,
              }))}
              value={tillIds}
              onChange={setTillIds}
            />
          )}
          <p className="text-xs text-muted-foreground">{t('pos.cashiers.tillsHint')}</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('pos.fields.pin')}
            htmlFor="cashier-pin"
            hint={cashier ? t('pos.cashiers.pinKeep') : undefined}
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
        <DialogFormFooter
          pending={mutations.setPin.isPending || mutations.setCashierTills.isPending}
          onCancel={onClose}
        />
      </form>
    </DialogContent>
  );
}
