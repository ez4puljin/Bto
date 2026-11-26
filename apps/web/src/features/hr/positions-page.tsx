import { PAYROLL_AMOUNT_PATTERN } from '@tugeel/shared/payroll';
import { Archive, ArchiveRestore, BriefcaseBusiness, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRoles } from '@/features/identity/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { nextPositionMonth } from './position-helpers';
import { PositionPermissions, PositionRolePreview } from './position-kit';
import { type HrPosition, usePositions, useWorkforceMutations } from './workforce-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'salary', kind: 'money', width: 11 },
  { key: 'scheduled', kind: 'text', weight: 2, min: 12 },
  { key: 'members', kind: 'count', width: 7 },
  { key: 'actions', kind: 'actions', actions: 2 },
];

function PositionDialog({
  position,
  onClose,
}: {
  position: HrPosition | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const roles = useRoles();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [name, setName] = useState(position?.name ?? '');
  const [salary, setSalary] = useState(
    (position?.nextBaseSalary ?? position?.baseSalary ?? '').replace(/\.00$/, ''),
  );
  const [roleIds, setRoleIds] = useState<number[]>(position?.roleIds ?? []);
  const [errors, setErrors] = useState<{ name?: string; salary?: string }>({});
  const selected = (roles.data ?? []).filter((role) => roleIds.includes(role.id));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      name: name.trim() === '' ? 'validation.required' : undefined,
      salary: PAYROLL_AMOUNT_PATTERN.test(salary) ? undefined : 'validation.money',
    };
    setErrors(next);
    if (next.name || next.salary || !roles.data) return;
    const ok = await action.run(() =>
      mutations.savePosition.mutateAsync({
        id: position?.id ?? null,
        name: name.trim(),
        baseSalary: salary,
        roleIds,
      }),
    );
    if (ok) {
      toast.success(t(position ? 'hr.positions.saved' : 'hr.positions.created'));
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <DialogHeader>
          <DialogTitle>{t(position ? 'hr.positions.edit' : 'hr.positions.create')}</DialogTitle>
        </DialogHeader>
        <form
          className="@container flex flex-col gap-4"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <ProblemAlert
            problem={action.problem ?? problemFromError(roles.error)}
            onRetry={roles.refetch}
          />
          <div className="grid gap-4 @xl:grid-cols-2">
            <FormField label={t('hr.positions.name')} htmlFor="position-name" error={errors.name}>
              <Input
                id="position-name"
                autoFocus
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField
              label={t(position ? 'hr.positions.nextSalary' : 'hr.positions.salary')}
              htmlFor="position-salary"
              error={errors.salary}
              hint={
                position
                  ? t('hr.positions.nextMonthHint', { month: nextPositionMonth() })
                  : t('hr.positions.initialMonthHint')
              }
            >
              <MoneyInput id="position-salary" value={salary} onValueChange={setSalary} />
            </FormField>
          </div>
          {position && position.baseSalary !== null ? (
            <p className="text-sm text-muted-foreground">
              {t('hr.positions.currentAmount', { amount: formatMnt(position.baseSalary) })}
            </p>
          ) : null}
          <FormField label={t('hr.positions.roles')} hint={t('hr.positions.rolesHint')}>
            <div className="grid gap-2 @xl:grid-cols-2">
              {(roles.data ?? []).map((role) => (
                <label
                  key={role.id}
                  className="flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={roleIds.includes(role.id)}
                    onCheckedChange={(checked) =>
                      setRoleIds((ids) =>
                        checked ? [...ids, role.id] : ids.filter((id) => id !== role.id),
                      )
                    }
                  />
                  <RoleName role={role} />
                </label>
              ))}
            </div>
          </FormField>
          <PositionRolePreview roles={selected} />
          <p className="text-xs text-muted-foreground">{t('hr.positions.rightsImmediate')}</p>
          <DialogFormFooter
            pending={mutations.savePosition.isPending}
            onCancel={onClose}
            submitLabel={t(position ? 'common.save' : 'common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PositionsPage() {
  const { t } = useTranslation();
  const auth = useAuthState();
  const admin =
    auth.status === 'authenticated' && auth.me.roles.some((role) => role.code === 'ADMIN');
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const archived = search.get('archived') === '1';
  const positions = usePositions(archived);
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<HrPosition | null>(null);
  const archive = async (position: HrPosition, value: boolean) => {
    const ok = await action.run(() =>
      mutations.archivePosition.mutateAsync({ id: position.id, archived: value }),
    );
    if (ok) toast.success(t(value ? 'hr.positions.archivedToast' : 'hr.positions.restoredToast'));
  };
  return (
    <div>
      <PageHeader
        title={t('hr.positions.title')}
        description={t('hr.positions.description')}
        actions={
          admin ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('hr.positions.create')}
            </Button>
          ) : undefined
        }
      />
      {!admin ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('hr.positions.adminOnly')}</p>
      ) : null}
      <FilterBar>
        <FilterToggle
          label={t('hr.positions.showArchived')}
          checked={archived}
          onCheckedChange={(checked) => setParam('archived', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert
        problem={action.problem ?? problemFromError(positions.error)}
        onRetry={positions.refetch}
      />
      <ListCard scroll>
        {positions.data?.length === 0 ? (
          <EmptyState title={t('hr.positions.empty')} icon={BriefcaseBusiness} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.positions.name')}</TableHead>
                <TableHead className="text-right">{t('hr.positions.salary')}</TableHead>
                <TableHead>{t('hr.positions.scheduled')}</TableHead>
                <TableHead className="text-right">{t('hr.positions.members')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.isPending ? <SkeletonRows columns={5} /> : null}
              {(positions.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="mb-2 font-medium">
                      {row.name}{' '}
                      {row.archivedAt ? (
                        <Badge variant="outline">{t('hr.positions.archived')}</Badge>
                      ) : null}
                    </p>
                    <PositionPermissions
                      permissions={row.roles.flatMap((role) => role.permissions)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.baseSalary !== null ? formatMnt(row.baseSalary) : t('common.none')}
                  </TableCell>
                  <TableCell>
                    {row.nextBaseSalary && row.nextEffectiveMonth ? (
                      <>
                        <p className="font-mono">{formatMnt(row.nextBaseSalary)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('hr.positions.effectiveMonth', { month: row.nextEffectiveMonth })}
                        </p>
                      </>
                    ) : (
                      t('hr.positions.noScheduled')
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.employeeCount}</TableCell>
                  {admin ? (
                    <RowActions>
                      <RowAction
                        label={t('hr.positions.editFor', { name: row.name })}
                        icon={Pencil}
                        onClick={() => setEditing(row)}
                      />
                      <RowAction
                        label={t(
                          row.archivedAt ? 'hr.positions.restoreFor' : 'hr.positions.archiveFor',
                          { name: row.name },
                        )}
                        icon={row.archivedAt ? ArchiveRestore : Archive}
                        destructive={!row.archivedAt}
                        onClick={() => void archive(row, !row.archivedAt)}
                      />
                    </RowActions>
                  ) : (
                    <TableCell />
                  )}
                </TableRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {admin && creating ? (
        <PositionDialog position={null} onClose={() => setCreating(false)} />
      ) : null}
      {admin && editing ? (
        <PositionDialog position={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
