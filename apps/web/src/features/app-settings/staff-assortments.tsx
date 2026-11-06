import { ChevronDown, Plus, Trash2, UsersRound } from 'lucide-react';
import { type FormEvent, useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useUserLookup } from '@/features/inventory/api';
import type { Choice } from '@/features/pricing/program-choices';
import { ChoicesPicker, Chips } from '@/features/pricing/program-targets';
import { useSegments } from '@/features/segments/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type StaffAssortment, useStaffAssortmentMutations, useStaffAssortments } from './api';

const sameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  [...a].sort((x, y) => x - y).every((id, i) => id === [...b].sort((x, y) => x - y)[i]);

/** Staff found by name on the server; the chosen ones stay as chips. */
function StaffPicker(props: {
  id: string;
  users: readonly Choice[];
  onChange: (users: Choice[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useUserLookup(q, q.length > 0);
  const chosen = new Set(props.users.map((user) => user.id));
  const rows = (found.data ?? []).filter((user) => !chosen.has(user.id));
  return (
    <div className="min-w-0">
      <SearchSelect
        id={props.id}
        value=""
        placeholder={t('appSettings.staffProducts.findStaff')}
        options={rows.map((user) => ({ value: String(user.id), label: user.fullName }))}
        onSearch={setSearch}
        searching={found.isFetching}
        onChange={(value) => {
          const user = rows.find((row) => String(row.id) === value);
          if (user) props.onChange([...props.users, { id: user.id, label: user.fullName }]);
        }}
      />
      <Chips
        items={props.users}
        onRemove={(id) => props.onChange(props.users.filter((user) => user.id !== id))}
      />
    </div>
  );
}

/** One setting: its title and what it names, folding away when it is not being changed. */
function AssortmentCard(props: {
  row: StaffAssortment | null;
  segments: readonly Choice[];
  onClosed?: () => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const mutations = useStaffAssortmentMutations();
  const action = useAction();
  const [open, setOpen] = useState(row === null);
  const [title, setTitle] = useState(row?.title ?? '');
  const [segmentIds, setSegmentIds] = useState<number[]>(
    row?.segments.map((segment) => segment.id) ?? [],
  );
  const [users, setUsers] = useState<Choice[]>(
    row?.users.map((user) => ({ id: user.id, label: user.fullName })) ?? [],
  );
  const [checked, setChecked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [key] = useState(randomUuid);
  const ids = row ? String(row.id) : 'new';
  const userIds = users.map((user) => user.id);
  const changed =
    row === null ||
    title.trim() !== row.title ||
    row.goneSegmentCount > 0 ||
    !sameIds(
      segmentIds,
      row.segments.map((segment) => segment.id),
    ) ||
    !sameIds(
      userIds,
      row.users.map((user) => user.id),
    );
  const pending = mutations.create.isPending || mutations.update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (title.trim() === '' || segmentIds.length === 0 || users.length === 0) return;
    const body = { title: title.trim(), segmentIds, userIds };
    void action
      .run(async () => {
        if (row) await mutations.update.mutateAsync({ id: row.id, body });
        else await mutations.create.mutateAsync({ key, body });
      })
      .then((ok) => {
        if (!ok) return;
        toast.success(t('appSettings.staffProducts.saved'));
        if (!row) props.onClosed?.();
      });
  };

  const required = (empty: boolean) => (checked && empty ? 'validation.required' : undefined);

  return (
    <Card role="region" aria-label={row?.title ?? t('appSettings.staffProducts.newTitle')}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {row?.title ?? t('appSettings.staffProducts.newTitle')}
        </span>
        {row ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('appSettings.staffProducts.summary', {
              segments: row.segments.length,
              staff: row.users.length,
            })}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <CardContent className="border-t pt-4">
          <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
            <ProblemAlert problem={action.problem} />
            {row && row.goneSegmentCount > 0 ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-[0.8125rem] text-warning">
                {t('appSettings.staffProducts.gone', { n: row.goneSegmentCount })}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('appSettings.staffProducts.name')}
                htmlFor={`staff-title-${ids}`}
                error={required(title.trim() === '')}
              >
                <Input
                  id={`staff-title-${ids}`}
                  autoComplete="off"
                  maxLength={120}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </FormField>
              <FormField
                label={t('appSettings.staffProducts.segments')}
                htmlFor={`staff-segments-${ids}`}
                error={required(segmentIds.length === 0)}
              >
                <ChoicesPicker
                  id={`staff-segments-${ids}`}
                  placeholder={t('appSettings.staffProducts.findSegment')}
                  options={props.segments}
                  ids={segmentIds}
                  onChange={setSegmentIds}
                />
              </FormField>
            </div>
            <FormField
              label={t('appSettings.staffProducts.staff')}
              htmlFor={`staff-users-${ids}`}
              error={required(users.length === 0)}
            >
              <StaffPicker id={`staff-users-${ids}`} users={users} onChange={setUsers} />
            </FormField>
            <div className="flex items-center justify-end gap-2">
              {row ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto text-destructive"
                  onClick={() => setAsking(true)}
                >
                  <Trash2 />
                  {t('common.delete')}
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={props.onClosed}>
                  {t('common.cancel')}
                </Button>
              )}
              <Button type="submit" disabled={pending || !changed}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
      {row ? (
        <ConfirmDialog
          open={asking}
          title={t('common.delete')}
          description={t('appSettings.staffProducts.deleteConfirm', { name: row.title })}
          confirmLabel={t('common.delete')}
          pending={mutations.remove.isPending}
          problem={action.problem}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            void action.run(async () => {
              await mutations.remove.mutateAsync(row.id);
              toast.success(t('appSettings.staffProducts.deleted'));
            })
          }
        />
      ) : null}
    </Card>
  );
}

/**
 * «Апп → Бараа»'s staff tab (ADR-0164): settings of any number of product segments and staff, each a
 * card that folds; a staff member sees what all theirs hold, and every sale-ready product without one.
 */
export function StaffAssortments() {
  const { t } = useTranslation();
  const rows = useStaffAssortments();
  const segments = useSegments('PRODUCT');
  const [adding, setAdding] = useState(false);
  const choices = (segments.data ?? []).map((segment) => ({
    id: segment.id,
    label: segment.name,
  }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('appSettings.staffProducts.hint')}
        </p>
        <Button disabled={adding} onClick={() => setAdding(true)}>
          <Plus />
          {t('appSettings.staffProducts.add')}
        </Button>
      </div>
      <ProblemAlert problem={problemFromError(rows.error)} onRetry={rows.refetch} />
      <ProblemAlert problem={problemFromError(segments.error)} onRetry={segments.refetch} />
      {adding ? (
        <AssortmentCard key="new" row={null} segments={choices} onClosed={() => setAdding(false)} />
      ) : null}
      {(rows.data ?? []).map((row) => (
        <AssortmentCard key={row.id} row={row} segments={choices} />
      ))}
      {rows.isSuccess && rows.data.length === 0 && !adding ? (
        <EmptyState icon={UsersRound} title={t('appSettings.staffProducts.empty')} />
      ) : null}
    </div>
  );
}
