import { PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Archive, ArchiveRestore, ClipboardList, Pencil, Plus, UserPlus } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import {
  type PayrollTemplate,
  useAllTerms,
  usePayrollMutations,
  useTemplates,
} from './payroll-api';
import { draftsOf, type ItemDraft, itemsProblem, money, requestOf } from './payroll-helpers';
import { KpiItemsEditor } from './payroll-kit';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'items', kind: 'text', weight: 4, min: 14, drop: 1 },
  { key: 'count', kind: 'count', width: 7 },
  { key: 'total', kind: 'money', width: 10 },
  { key: 'actions', kind: 'actions', actions: 3 },
];

function TemplateDialog(props: { template: PayrollTemplate | null; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePayrollMutations();
  const action = useAction();
  const key = useRef(randomUuid());
  const [name, setName] = useState(props.template?.name ?? '');
  const [items, setItems] = useState<ItemDraft[]>(() => draftsOf(props.template?.items ?? []));
  const [error, setError] = useState<string | undefined>();
  const [itemsError, setItemsError] = useState<string | undefined>();
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') {
      setError('validation.required');
      return;
    }
    const problem = itemsProblem(items);
    if (problem) {
      setItemsError(problem);
      return;
    }
    const ok = await action.run(() =>
      mutations.saveTemplate.mutateAsync({
        id: props.template?.id ?? null,
        key: key.current,
        name: name.trim(),
        items: requestOf(items),
      }),
    );
    if (ok) {
      toast.success(
        props.template ? t('payroll.web.templates.saved') : t('payroll.web.templates.created'),
      );
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <DialogHeader>
          <DialogTitle>
            {props.template ? t('payroll.web.templates.edit') : t('payroll.web.templates.create')}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField label={t('payroll.web.templates.name')} htmlFor="template-name" error={error}>
            <Input
              id="template-name"
              autoFocus
              maxLength={PAYROLL_LIMITS.maxName}
              placeholder={t('payroll.web.templates.namePlaceholder')}
              value={name}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField
            label={t('payroll.web.templates.items')}
            error={itemsError}
            hint={t('payroll.web.templates.itemsHint')}
          >
            <KpiItemsEditor
              idPrefix="template-item"
              items={items}
              onChange={(next) => {
                setItemsError(undefined);
                setItems(next);
              }}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.saveTemplate.isPending}
            onCancel={close}
            submitLabel={props.template ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Ажилтанд хэрэглэх»: the template's items replace the chosen people's sheets. */
function ApplyDialog(props: { template: PayrollTemplate; onClose: () => void }) {
  const { t } = useTranslation();
  const terms = useAllTerms();
  const mutations = usePayrollMutations();
  const action = useAction();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => {
    const words = queryTerms(query);
    return (terms.data ?? [])
      .filter((row) => !row.left)
      .filter(
        (row) =>
          words.length === 0 ||
          matchesQuery(
            searchKeys(row.fullName, [row.position ?? '', row.divisionName ?? '']),
            words,
          ),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }, [terms.data, query]);
  const toggle = (userId: number, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  const allShown = rows.length > 0 && rows.every((row) => chosen.has(row.userId));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(() =>
      mutations.applyTemplate.mutateAsync({ id: props.template.id, userIds: [...chosen] }),
    );
    if (ok) {
      toast.success(t('payroll.web.templates.applied', { count: chosen.size }));
      props.onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <DialogHeader>
          <DialogTitle>
            {t('payroll.web.templates.applyTitle', { name: props.template.name })}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('payroll.web.templates.applyHint')}
          </p>
          <ProblemAlert problem={action.problem ?? problemFromError(terms.error)} />
          <SearchField
            aria-label={t('payroll.web.search')}
            placeholder={t('payroll.web.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={allShown}
                onCheckedChange={(on) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    for (const row of rows) {
                      if (on === true) next.add(row.userId);
                      else next.delete(row.userId);
                    }
                    return next;
                  })
                }
              />
              {t('common.selectAll')}
            </Label>
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('common.selected', { count: chosen.size })}
            </span>
          </div>
          <ul className="max-h-[min(24rem,45dvh)] divide-y divide-border/80 overflow-y-auto rounded-xl border">
            {rows.map((row) => (
              <li key={row.userId}>
                <Label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal touch:min-h-11">
                  <Checkbox
                    checked={chosen.has(row.userId)}
                    onCheckedChange={(on) => toggle(row.userId, on === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[row.position, row.divisionName].filter(Boolean).join(' · ') ||
                        t('common.none')}
                    </span>
                  </span>
                  {row.hasTerms ? null : (
                    <Badge variant="outline">{t('payroll.web.terms.noTerms')}</Badge>
                  )}
                </Label>
              </li>
            ))}
            {terms.data && rows.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('common.noMatches')}
              </li>
            ) : null}
          </ul>
          <DialogFormFooter
            pending={mutations.applyTemplate.isPending}
            onCancel={props.onClose}
            disabled={chosen.size === 0}
            submitLabel={t('payroll.web.templates.apply')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «KPI загвар» (ADR-0235, hr.payroll.view): the templates HR starts a person's sheet from
 * («Кассчин», «Жолооч»), each a list of KPI items. Managers add, edit and archive them and apply one
 * to chosen employees.
 */
export function PayrollTemplatesPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('hr.payroll.manage');
  const showArchived = search.get('archived') === '1';
  const templates = useTemplates(showArchived);
  const mutations = usePayrollMutations();
  const action = useAction();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const [editing, setEditing] = useState<PayrollTemplate | null>(null);
  const [applying, setApplying] = useState<PayrollTemplate | null>(null);
  const rows = templates.data ?? [];

  const archive = async (template: PayrollTemplate, archived: boolean) => {
    const ok = await action.run(() =>
      mutations.archiveTemplate.mutateAsync({ id: template.id, archived }),
    );
    if (ok) {
      toast.success(
        archived
          ? t('payroll.web.templates.archivedToast')
          : t('payroll.web.templates.restoredToast'),
      );
    }
  };

  return (
    <div>
      <PageHeader
        title={t('payroll.web.templates.title')}
        description={t('payroll.web.templates.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreatingOpen(true)}>
              <Plus />
              {t('payroll.web.templates.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <FilterToggle
          label={t('payroll.web.templates.showArchived')}
          checked={showArchived}
          onCheckedChange={(checked) => setParam('archived', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert
        problem={action.problem ?? problemFromError(templates.error)}
        onRetry={templates.refetch}
      />
      <ListCard scroll>
        {templates.data && rows.length === 0 ? (
          <EmptyState title={t('payroll.web.templates.empty')} icon={ClipboardList} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.web.templates.name')}</TableHead>
                <TableHead>{t('payroll.web.templates.items')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.templates.count')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.templates.total')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.isPending ? <SkeletonRows columns={5} /> : null}
              {rows.map((row) => {
                const archived = row.archivedAt !== null;
                return (
                  <TableRow key={row.id} className={cn(archived && 'text-muted-foreground')}>
                    <TableCell className="font-medium">
                      {row.name}
                      {archived ? (
                        <Badge variant="outline" className="ml-2">
                          {t('payroll.web.templates.archived')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {row.items.map((item) => item.name).join(', ') || t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.items.length}</TableCell>
                    <TableCell className="text-right font-mono">{money(row.total)}</TableCell>
                    {canManage ? (
                      <RowActions>
                        <RowAction
                          label={t('payroll.web.templates.applyFor', { name: row.name })}
                          icon={UserPlus}
                          disabled={archived}
                          onClick={() => setApplying(row)}
                        />
                        <RowAction
                          label={t('payroll.web.templates.editFor', { name: row.name })}
                          icon={Pencil}
                          onClick={() => setEditing(row)}
                        />
                        {archived ? (
                          <RowAction
                            label={t('payroll.web.templates.restoreFor', { name: row.name })}
                            icon={ArchiveRestore}
                            onClick={() => void archive(row, false)}
                          />
                        ) : (
                          <RowAction
                            label={t('payroll.web.templates.archiveFor', { name: row.name })}
                            icon={Archive}
                            destructive
                            onClick={() => void archive(row, true)}
                          />
                        )}
                      </RowActions>
                    ) : (
                      <TableCell />
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {creatingOpen && canManage ? (
        <TemplateDialog template={null} onClose={() => setCreatingOpen(false)} />
      ) : null}
      {editing ? <TemplateDialog template={editing} onClose={() => setEditing(null)} /> : null}
      {applying ? <ApplyDialog template={applying} onClose={() => setApplying(null)} /> : null}
    </div>
  );
}
