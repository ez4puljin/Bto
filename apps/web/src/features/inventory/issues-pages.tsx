import { Archive, ArchiveRestore, Check, PackageOpen, Pencil, Plus, Tags, X } from 'lucide-react';
import { type FormEvent, useDeferredValue, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { RequirePermission } from '@/app/require-auth';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  RowAction,
  SearchField,
  SkeletonRows,
  TruncateCell,
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
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import {
  type IssueDetail,
  type IssueExpenseType,
  type IssueStatus,
  useIssue,
  useIssueExpenseTypes,
  useIssueMutations,
  useIssues,
} from './api';
import { useWarehouseName, useWarehouseOptions, wantsScanFocus } from './helpers';
import { IssueForm } from './issue-form';
import { DocStatusBadge, WarehouseSelect } from './shared';

const ISSUE_STATUSES: readonly IssueStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];
const ISSUE_WAREHOUSES = ['WHOLESALE', 'STORE'] as const;

const isStatus = (value: string | null): value is IssueStatus =>
  ISSUE_STATUSES.some((status) => status === value);
const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/** Goods issues (ADR-0081): goods leaving a warehouse for an expense type and a recipient. */
export function IssuesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.issues.manage');
  const canSetup = useHasPermission('inventory.setup.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [typesOpen, setTypesOpen] = useState(false);
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const warehouseId = positiveId(params.get('warehouseId'));
  const expenseTypeId = positiveId(params.get('type'));
  const warehouses = useWarehouseOptions(ISSUE_WAREHOUSES);
  const warehouseName = useWarehouseName();
  const types = useIssueExpenseTypes();
  const issues = useIssues({ q, status, warehouseId, expenseTypeId });
  const rows = issues.data?.pages.flatMap((page) => page.data) ?? [];

  if (params.get('new') === '1') return <Navigate to="/inventory/issues/new" replace />;

  return (
    <div>
      <PageHeader
        title={t('inventory.issues.title')}
        actions={
          <>
            {canSetup ? (
              <Button type="button" variant="outline" onClick={() => setTypesOpen(true)}>
                <Tags />
                {t('inventory.issues.types.open')}
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild>
                <Link to="/inventory/issues/new">
                  <Plus />
                  {t('inventory.issues.create')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('inventory.issues.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('inventory.issues.expenseType')}
          value={expenseTypeId ?? ''}
          onChange={(event) => setParam('type', event.target.value)}
        >
          <option value="">{t('inventory.issues.allExpenseTypes')}</option>
          {(types.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('inventory.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('inventory.adjustments.allStatuses')}</option>
          {ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.docStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(issues.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead>{t('inventory.issues.expenseType')}</TableHead>
              <TableHead>{t('inventory.issues.recipient')}</TableHead>
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((issue) => (
              <LinkRow key={issue.id} to={`/inventory/issues/${issue.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/issues/${issue.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {issue.number ?? t('inventory.draftNo', { id: issue.id })}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{issue.issuedOn}</TableCell>
                <TableCell>{warehouseName(issue.warehouseId)}</TableCell>
                <TruncateCell text={issue.expenseTypeName} />
                <TruncateCell
                  text={
                    issue.recipientName
                      ? `${t(`inventory.issues.recipientKinds.${issue.recipientKind}`)} · ${issue.recipientName}`
                      : t(`inventory.issues.recipientKinds.${issue.recipientKind}`)
                  }
                />
                <TableCell className="text-right font-mono">{issue.lineCount}</TableCell>
                <TableCell>
                  <DocStatusBadge status={issue.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!issues.isPending && rows.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t('inventory.issues.empty')} />
        ) : null}
        <LoadMore query={issues} />
      </ListCard>
      {canSetup ? (
        <ExpenseTypesDialog open={typesOpen} onClose={() => setTypesOpen(false)} />
      ) : null}
    </div>
  );
}

/**
 * The expense types (inventory.setup.manage): add, rename, retire and bring back. A retired type
 * is no longer offered to a new issue; old issues keep naming it. The dialog stays open after each
 * change and says what happened inside itself (toasts are hidden behind a modal dialog).
 */
function ExpenseTypesDialog(props: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const types = useIssueExpenseTypes();
  const mutations = useIssueMutations();
  const action = useAction();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [said, setSaid] = useState('');
  const newName = useRef<HTMLInputElement>(null);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const text = name.trim();
    if (!text) return;
    void action.run(async () => {
      const type = await mutations.createType.mutateAsync(text);
      setName('');
      setSaid(t('inventory.issues.types.added', { name: type.name }));
      newName.current?.focus();
    });
  };
  const rename = (type: IssueExpenseType) => {
    const text = editing?.name.trim() ?? '';
    if (!text || text === type.name) {
      setEditing(null);
      return;
    }
    void action.run(async () => {
      const saved = await mutations.updateType.mutateAsync({ id: type.id, body: { name: text } });
      setEditing(null);
      setSaid(t('inventory.issues.types.renamed', { name: saved.name }));
    });
  };
  const toggle = (type: IssueExpenseType) =>
    void action.run(async () => {
      const saved = await mutations.updateType.mutateAsync({
        id: type.id,
        body: { active: !type.active },
      });
      setSaid(
        t(saved.active ? 'inventory.issues.types.reactivated' : 'inventory.issues.types.retired', {
          name: saved.name,
        }),
      );
    });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) return;
        setEditing(null);
        setSaid('');
        action.clear();
        props.onClose();
      }}
    >
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('inventory.issues.types.title')}</DialogTitle>
          <DialogDescription>{t('inventory.issues.types.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(types.error) ?? action.problem} />
        {types.data && types.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inventory.issues.types.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {(types.data ?? []).map((type) => (
              <li key={type.id} className="flex min-h-10 items-center gap-2 px-3 py-1">
                {editing?.id === type.id ? (
                  <>
                    <Input
                      autoFocus
                      maxLength={100}
                      aria-label={t('inventory.issues.types.name')}
                      className="h-8"
                      value={editing.name}
                      onChange={(event) => setEditing({ id: type.id, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          rename(type);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditing(null);
                        }
                      }}
                    />
                    <RowAction
                      label={t('inventory.issues.types.saveName', { name: type.name })}
                      icon={Check}
                      disabled={mutations.updateType.isPending}
                      onClick={() => rename(type)}
                    />
                    <RowAction
                      label={t('inventory.issues.types.cancelRename', { name: type.name })}
                      icon={X}
                      onClick={() => setEditing(null)}
                    />
                  </>
                ) : (
                  <>
                    <span
                      className={
                        type.active
                          ? 'min-w-0 flex-1 text-sm'
                          : 'min-w-0 flex-1 text-sm text-muted-foreground'
                      }
                    >
                      {type.name}
                    </span>
                    {type.active ? null : (
                      <Badge variant="outline">{t('inventory.issues.types.inactive')}</Badge>
                    )}
                    <RowAction
                      label={t('inventory.issues.types.rename', { name: type.name })}
                      icon={Pencil}
                      onClick={() => {
                        action.clear();
                        setEditing({ id: type.id, name: type.name });
                      }}
                    />
                    <RowAction
                      label={t(
                        type.active
                          ? 'inventory.issues.types.retire'
                          : 'inventory.issues.types.reactivate',
                        { name: type.name },
                      )}
                      icon={type.active ? Archive : ArchiveRestore}
                      disabled={mutations.updateType.isPending}
                      onClick={() => toggle(type)}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-col gap-1.5" onSubmit={add}>
          <Label htmlFor="issue-type-new">{t('inventory.issues.types.newName')}</Label>
          <div className="flex gap-2">
            <Input
              ref={newName}
              id="issue-type-new"
              maxLength={100}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={mutations.createType.isPending || name.trim() === ''}
            >
              <Plus />
              {t('inventory.issues.types.add')}
            </Button>
          </div>
        </form>
        <p aria-live="polite" className="min-h-5 text-sm font-medium text-success">
          {said}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One goods issue on its own page (`/inventory/issues/:id`, `new` for one not made yet), like a
 * receipt: a new issue takes its draft's address once its first line is added and the page stays
 * mounted, so the scan box keeps the cursor and the active shelf.
 */
export function IssuePage() {
  const { t } = useTranslation();
  const param = useParams().id ?? '';
  const isNew = param === 'new';
  const id = isNew ? Number.NaN : Number.parseInt(param, 10);
  const location = useLocation();
  const canManage = useHasPermission('inventory.issues.manage');
  const issue = useIssue(id, !Number.isNaN(id));
  const created = useRef<number | null>(null);
  const onCreated = (newId: number) => {
    created.current = newId;
  };

  if (isNew) {
    if (!canManage)
      return <RequirePermission permission="inventory.issues.manage">{null}</RequirePermission>;
    return <IssueScreen key="new" detail={null} focusScan={false} onCreated={onCreated} />;
  }
  const loadProblem = problemFromError(issue.error);
  if (loadProblem || !issue.data) {
    return (
      <div>
        <PageHeader title={t('inventory.issues.title')} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return (
    <IssueScreen
      key={created.current === id ? 'new' : String(id)}
      detail={issue.data}
      focusScan={wantsScanFocus(location.state)}
      onCreated={onCreated}
    />
  );
}

function IssueScreen(props: {
  detail: IssueDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { detail } = props;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          detail === null
            ? t('inventory.issues.newTitle')
            : (detail.number ?? t('inventory.draftNo', { id: detail.id }))
        }
        description={detail === null ? t('inventory.issues.newDescription') : undefined}
        meta={
          detail ? (
            <>
              <DocStatusBadge status={detail.status} />
              {detail.postedAt ? (
                <span>
                  {t('inventory.issues.postedAt', {
                    time: formatUbDateTime(Date.parse(detail.postedAt)),
                  })}
                </span>
              ) : detail.effectiveDate ? (
                <span>{t('inventory.postedOn', { date: detail.effectiveDate })}</span>
              ) : null}
            </>
          ) : undefined
        }
      />
      <IssueForm detail={detail} focusScan={props.focusScan} onCreated={props.onCreated} />
    </div>
  );
}
