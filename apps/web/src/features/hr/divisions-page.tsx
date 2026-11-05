import { WORKFORCE_LIMITS } from '@tugeel/shared/hr';
import { Archive, ArchiveRestore, Building2, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { type HrDivision, useDivisions, useWorkforceMutations } from './workforce-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'members', kind: 'count', width: 7 },
  { key: 'sort', kind: 'count', width: 6 },
  { key: 'actions', kind: 'actions', actions: 2 },
];

function DivisionDialog(props: {
  division: HrDivision | null;
  onClose: () => void;
  nextSort: number;
}) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [name, setName] = useState(props.division?.name ?? '');
  const [sort, setSort] = useState(String(props.division?.sort ?? props.nextSort));
  const [error, setError] = useState<string | undefined>();
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
    const ok = await action.run(() =>
      mutations.saveDivision.mutateAsync({
        id: props.division?.id ?? null,
        name: name.trim(),
        sort: /^\d+$/.test(sort) ? Number(sort) : 0,
      }),
    );
    if (ok) {
      toast.success(props.division ? t('hr.divisions.saved') : t('hr.divisions.created'));
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>
            {props.division ? t('hr.divisions.edit') : t('hr.divisions.create')}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField label={t('hr.divisions.name')} htmlFor="division-name" error={error}>
            <Input
              id="division-name"
              autoFocus
              maxLength={WORKFORCE_LIMITS.maxName}
              value={name}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField label={t('hr.divisions.sort')} htmlFor="division-sort">
            <Input
              id="division-sort"
              inputMode="numeric"
              className="sm:w-28"
              value={sort}
              onChange={(event) => setSort(event.target.value.replace(/\D/g, ''))}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.saveDivision.isPending}
            onCancel={close}
            submitLabel={props.division ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Алба хэлтэс» (ADR-0144): the company's divisions with how many employees each holds; HR adds,
 * renames and archives them (an archived one keeps its people's history).
 */
export function DivisionsPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('hr.attendance.manage');
  const showArchived = search.get('archived') === '1';
  const divisions = useDivisions(showArchived);
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const creating = { open: creatingOpen, setOpen: setCreatingOpen };
  const [editing, setEditing] = useState<HrDivision | null>(null);
  const rows = divisions.data ?? [];
  const nextSort = rows.reduce((max, row) => Math.max(max, row.sort), 0) + 1;

  const archive = async (division: HrDivision, archived: boolean) => {
    const ok = await action.run(() =>
      mutations.archiveDivision.mutateAsync({ id: division.id, archived }),
    );
    if (ok)
      toast.success(archived ? t('hr.divisions.archivedToast') : t('hr.divisions.restoredToast'));
  };

  return (
    <div>
      <PageHeader
        title={t('hr.divisions.title')}
        description={t('hr.divisions.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => creating.setOpen(true)}>
              <Plus />
              {t('hr.divisions.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <FilterToggle
          label={t('hr.divisions.showArchived')}
          checked={showArchived}
          onCheckedChange={(checked) => setParam('archived', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert
        problem={action.problem ?? problemFromError(divisions.error)}
        onRetry={divisions.refetch}
      />
      <ListCard>
        {divisions.data && rows.length === 0 ? (
          <EmptyState title={t('hr.divisions.empty')} icon={Building2} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.divisions.name')}</TableHead>
                <TableHead className="text-right">{t('hr.divisions.members')}</TableHead>
                <TableHead className="text-right">{t('hr.divisions.sort')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {divisions.isPending ? <SkeletonRows columns={4} /> : null}
              {rows.map((row) => {
                const archived = row.archivedAt !== null;
                return (
                  <TableRow key={row.id} className={cn(archived && 'text-muted-foreground')}>
                    <TableCell className="font-medium">
                      {row.name}
                      {archived ? (
                        <Badge variant="outline" className="ml-2">
                          {t('hr.divisions.archived')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.employeeCount}</TableCell>
                    <TableCell className="text-right font-mono">{row.sort}</TableCell>
                    {canManage ? (
                      <RowActions>
                        <RowAction
                          label={t('hr.divisions.editFor', { name: row.name })}
                          icon={Pencil}
                          onClick={() => setEditing(row)}
                        />
                        {archived ? (
                          <RowAction
                            label={t('hr.divisions.restoreFor', { name: row.name })}
                            icon={ArchiveRestore}
                            onClick={() => void archive(row, false)}
                          />
                        ) : (
                          <RowAction
                            label={t('hr.divisions.archiveFor', { name: row.name })}
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
      {creating.open ? (
        <DivisionDialog
          division={null}
          nextSort={nextSort}
          onClose={() => creating.setOpen(false)}
        />
      ) : null}
      {editing ? (
        <DivisionDialog division={editing} nextSort={nextSort} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
