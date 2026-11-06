import {
  Archive,
  ArchiveRestore,
  BadgePercent,
  Pencil,
  Plus,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { FieldList } from '@/components/detail';
import { FilterChoices, FilterOption, FilterSection } from '@/components/filter-panel';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  RowAction,
  RowActions,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductSearch } from '@/features/inventory/shared';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type DiscountProgram,
  type ProgramFilter,
  type ProgramStatus,
  useDiscountProgram,
  useDiscountPrograms,
  usePricingMutations,
} from './api';
import { nineFactorKey } from './helpers';
import { usePipelineChoices, useProgramNames, useTillChoices } from './program-choices';
import { useProgramText } from './program-text';

const STATUSES = ['ACTIVE', 'SCHEDULED', 'DRAFT', 'ENDED', 'ARCHIVED'] as const;
const APPLY_TYPES = ['PRODUCT', 'CATEGORY', 'SUPPLIER', 'SEGMENT', 'ORDER'] as const;
const PRIORITIES = ['ONLY', 'EXCLUDE'] as const;
const CONDITIONS = ['QTY', 'AMOUNT'] as const;

const STATUS_VARIANT: Record<ProgramStatus, 'success' | 'default' | 'secondary' | 'outline'> = {
  ACTIVE: 'success',
  SCHEDULED: 'default',
  DRAFT: 'outline',
  ENDED: 'secondary',
  ARCHIVED: 'secondary',
};

export function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`pricing.programs.status.${status}`)}</Badge>;
}

/** The list's columns (ADR-0119): the steps say the effect too (→ 1%, → 22,800₮, → −500₮). */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 10.5 },
  { key: 'status', kind: 'status', width: 6.5 },
  { key: 'priority', kind: 'icon', width: 2.5 },
  { key: 'apply', kind: 'text', weight: 3, min: 7.5 },
  { key: 'steps', kind: 'text', weight: 1, min: 7 },
  { key: 'createdBy', kind: 'text', weight: 1, min: 5 },
  { key: 'createdAt', kind: 'date', width: 7 },
  { key: 'updatedAt', kind: 'date', width: 7 },
  { key: 'actions', kind: 'actions', actions: 3 },
  { key: 'chevron', kind: 'chevron' },
];

const positive = (value: string | null): number | undefined => {
  const id = Number.parseInt(value ?? '', 10);
  return id > 0 ? id : undefined;
};

const inList = <T extends string>(options: readonly T[], value: string | null): T | undefined =>
  options.find((option) => option === value);

/**
 * «Хямдралын тохиргоо» (ADR-0159, the owner's pricing plans of Erxes): filters on the left and every
 * plan but the archived ones, newest first, with who made it and its row's edit, archive and delete.
 */
export function DiscountProgramsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.manage');
  const [params, setParams] = useSearchParams();
  const status = inList(STATUSES, params.get('status'));
  const applyType = inList(APPLY_TYPES, params.get('apply'));
  const priority = inList(PRIORITIES, params.get('priority'));
  const condition = inList(CONDITIONS, params.get('condition'));
  const productId = positive(params.get('pr'));
  const pipelineId = positive(params.get('pipeline'));
  const tillId = positive(params.get('till'));
  const date = params.get('date') ?? undefined;
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const filter: ProgramFilter = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(applyType ? { applyType } : {}),
    ...(priority ? { priority } : {}),
    ...(condition ? { condition } : {}),
    ...(productId ? { productId } : {}),
    ...(pipelineId ? { pipelineId } : {}),
    ...(tillId ? { tillId } : {}),
    ...(date ? { date } : {}),
  };
  const programs = useDiscountPrograms(filter);
  const rows = programs.data?.pages.flatMap((page) => page.data) ?? [];
  const pipelines = usePipelineChoices();
  const tills = useTillChoices();
  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const filtered = Object.keys(filter).length > 0;
  const clear = () => {
    setSearch('');
    setParams({}, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('pricing.programs.title')}
        description={t('pricing.programs.intro')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/pricing/discounts/new">
                <Plus />
                {t('pricing.programs.new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex items-start gap-3">
        <aside
          aria-label={t('pricing.programs.panel.label')}
          className="hidden w-52 shrink-0 lg:block"
        >
          <ListCard scroll beside>
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
              <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{t('pricing.programs.panel.title')}</span>
              {filtered ? (
                <Button type="button" size="xs" variant="ghost" onClick={clear}>
                  {t('pricing.programs.panel.clear')}
                </Button>
              ) : null}
            </div>
            <FilterSection
              title={t('pricing.programs.columns.status')}
              defaultOpen
              active={!!status}
            >
              <FilterChoices
                options={STATUSES}
                label={(value) => t(`pricing.programs.status.${value}`)}
                value={status ?? null}
                onChange={(value) => setParam('status', value)}
              />
            </FilterSection>
            <FilterSection
              title={t('pricing.programs.columns.apply')}
              defaultOpen
              active={!!applyType}
            >
              <FilterChoices
                options={APPLY_TYPES}
                label={(value) => t(`pricing.programs.applyTypes.${value}`)}
                value={applyType ?? null}
                onChange={(value) => setParam('apply', value)}
              />
            </FilterSection>
            <FilterSection title={t('pricing.programs.fields.product')} active={!!productId}>
              {productId ? (
                <FilterOption
                  label={params.get('prn') ?? String(productId)}
                  active
                  hint={<X aria-hidden className="size-3.5 shrink-0" />}
                  onClick={() =>
                    setParams(
                      (current) => {
                        const next = new URLSearchParams(current);
                        next.delete('pr');
                        next.delete('prn');
                        return next;
                      },
                      { replace: true },
                    )
                  }
                />
              ) : (
                <ProductSearch
                  className="w-full"
                  pickLabel={t('pricing.programs.pickProduct')}
                  onPick={(picked) =>
                    setParams(
                      (current) => {
                        const next = new URLSearchParams(current);
                        next.set('pr', String(picked.id));
                        next.set('prn', picked.name);
                        return next;
                      },
                      { replace: true },
                    )
                  }
                />
              )}
            </FilterSection>
            <FilterSection title={t('pricing.programs.fields.priority')} active={!!priority}>
              <FilterChoices
                options={PRIORITIES}
                label={(value) => t(`pricing.programs.priorities.${value}`)}
                value={priority ?? null}
                onChange={(value) => setParam('priority', value)}
              />
            </FilterSection>
            <FilterSection title={t('pricing.programs.panel.condition')} active={!!condition}>
              <FilterChoices
                options={CONDITIONS}
                label={(value) => t(`pricing.programs.panel.conditions.${value}`)}
                value={condition ?? null}
                onChange={(value) => setParam('condition', value)}
              />
            </FilterSection>
            <FilterSection title={t('pricing.programs.fields.pipelines')} active={!!pipelineId}>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {pipelines.map((pipeline) => (
                  <FilterOption
                    key={pipeline.id}
                    label={pipeline.label}
                    active={pipelineId === pipeline.id}
                    onClick={() =>
                      setParam('pipeline', pipelineId === pipeline.id ? null : String(pipeline.id))
                    }
                  />
                ))}
              </div>
            </FilterSection>
            <FilterSection title={t('pricing.programs.fields.tills')} active={!!tillId}>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {tills.map((till) => (
                  <FilterOption
                    key={till.id}
                    label={till.label}
                    active={tillId === till.id}
                    onClick={() => setParam('till', tillId === till.id ? null : String(till.id))}
                  />
                ))}
              </div>
            </FilterSection>
            <FilterSection title={t('pricing.programs.panel.date')} active={!!date}>
              <DateInput
                aria-label={t('pricing.programs.panel.date')}
                value={date ?? ''}
                onChange={(value) => setParam('date', value || null)}
              />
            </FilterSection>
          </ListCard>
        </aside>
        <div className="min-w-0 flex-1">
          <FilterBar>
            <SearchField
              className="sm:w-60"
              aria-label={t('common.search')}
              placeholder={t('pricing.programs.search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setParam('q', event.target.value.trim() || null);
              }}
            />
          </FilterBar>
          <ProblemAlert problem={problemFromError(programs.error)} onRetry={programs.refetch} />
          <ProgramTable
            rows={rows}
            pending={programs.isPending}
            canManage={canManage}
            filtered={filtered}
            onClear={clear}
          >
            <LoadMore query={programs} />
          </ProgramTable>
        </div>
      </div>
    </div>
  );
}

type RowAct = { kind: 'archive' | 'restore' | 'delete'; program: DiscountProgram };

/** The plans as rows, each with its pencil, its archive and its delete. */
function ProgramTable(props: {
  rows: readonly DiscountProgram[];
  pending: boolean;
  canManage: boolean;
  filtered: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const text = useProgramText();
  const mutations = usePricingMutations();
  const action = useAction();
  const [acting, setActing] = useState<RowAct | null>(null);

  const run = async () => {
    if (!acting) return;
    const { kind, program } = acting;
    const ok = await action.run(() => {
      if (kind === 'delete') return mutations.deleteProgram.mutateAsync(program.id);
      if (kind === 'archive') return mutations.archiveProgram.mutateAsync(program.id);
      return mutations.restoreProgram.mutateAsync(program.id);
    });
    if (!ok) return;
    setActing(null);
    toast.success(t(`pricing.programs.done.${kind}`));
  };

  return (
    <>
      <ListCard scroll beside>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.programs.columns.name')}</TableHead>
              <TableHead>{t('pricing.programs.columns.status')}</TableHead>
              <TableHead title={t('pricing.programs.fields.priority')}>
                <Star aria-label={t('pricing.programs.fields.priority')} className="size-3.5" />
              </TableHead>
              <TableHead>{t('pricing.programs.columns.apply')}</TableHead>
              <TableHead>{t('pricing.programs.columns.steps')}</TableHead>
              <TableHead>{t('pricing.programs.columns.createdBy')}</TableHead>
              <TableHead>{t('pricing.programs.columns.createdAt')}</TableHead>
              <TableHead>{t('pricing.programs.columns.updatedAt')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('pricing.programs.columns.actions')}</span>
              </TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.pending ? <SkeletonRows columns={10} /> : null}
            {props.rows.map((program) => (
              <LinkRow key={program.id} to={`/pricing/discounts/${program.id}`}>
                <TruncateCell text={program.name}>
                  <Link
                    to={`/pricing/discounts/${program.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {program.name}
                  </Link>
                </TruncateCell>
                <TableCell>
                  <ProgramStatusBadge status={program.status} />
                </TableCell>
                <TableCell>
                  {program.priority ? (
                    <Star
                      aria-label={t('pricing.programs.fields.priority')}
                      className="size-4 fill-warning text-warning"
                    />
                  ) : null}
                </TableCell>
                <TruncateCell text={text.target(program)} />
                <TableCell>
                  {/* One step a line, each line whole. */}
                  <div className="flex flex-col whitespace-nowrap">
                    {program.steps.map((step) => (
                      <span key={step.threshold}>{text.step(program, step)}</span>
                    ))}
                  </div>
                </TableCell>
                <TruncateCell text={program.createdByName ?? t('common.none')} />
                {/* The day in the row, the minute on hover and on the plan's own page. */}
                <TableCell
                  className="font-mono text-xs"
                  title={formatUbDateTime(Date.parse(program.createdAt))}
                >
                  {formatUbDateTime(Date.parse(program.createdAt)).slice(0, 10)}
                </TableCell>
                <TableCell
                  className="font-mono text-xs"
                  title={formatUbDateTime(Date.parse(program.updatedAt))}
                >
                  {formatUbDateTime(Date.parse(program.updatedAt)).slice(0, 10)}
                </TableCell>
                {props.canManage ? (
                  <RowActions>
                    <RowAction
                      label={t('common.edit')}
                      icon={Pencil}
                      onClick={() => void navigate(`/pricing/discounts/${program.id}/edit`)}
                    />
                    {program.status === 'ARCHIVED' ? (
                      <RowAction
                        label={t('pricing.programs.restore')}
                        icon={ArchiveRestore}
                        onClick={() => setActing({ kind: 'restore', program })}
                      />
                    ) : (
                      <RowAction
                        label={t('pricing.programs.archive')}
                        icon={Archive}
                        onClick={() => setActing({ kind: 'archive', program })}
                      />
                    )}
                    <RowAction
                      label={t('pricing.programs.delete')}
                      icon={Trash2}
                      destructive
                      onClick={() => setActing({ kind: 'delete', program })}
                    />
                  </RowActions>
                ) : (
                  <TableCell />
                )}
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!props.pending && props.rows.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title={t('pricing.programs.empty')}
            {...(props.filtered ? { onClearFilters: props.onClear } : {})}
          />
        ) : null}
        {props.children}
      </ListCard>
      <ConfirmDialog
        open={acting !== null}
        title={t(`pricing.programs.confirm.${acting?.kind ?? 'archive'}.title`, {
          name: acting?.program.name ?? '',
        })}
        description={t(`pricing.programs.confirm.${acting?.kind ?? 'archive'}.description`)}
        confirmLabel={t(
          acting?.kind === 'delete'
            ? 'pricing.programs.delete'
            : acting?.kind === 'restore'
              ? 'pricing.programs.restore'
              : 'pricing.programs.archive',
        )}
        {...(acting?.kind === 'delete' ? { variant: 'destructive' as const } : {})}
        pending={
          mutations.deleteProgram.isPending ||
          mutations.archiveProgram.isPending ||
          mutations.restoreProgram.isPending
        }
        problem={action.problem}
        onConfirm={() => void run()}
        onClose={() => {
          action.clear();
          setActing(null);
        }}
      />
    </>
  );
}

/** One program: what it applies to, where, how much; its actions at any time. */
export function DiscountProgramPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const program = useDiscountProgram(id);
  const loadProblem = problemFromError(program.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!program.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return <ProgramDetail program={program.data} />;
}

type DetailAct = 'stop' | 'archive' | 'restore' | 'delete';

const listed = (names: readonly string[], none: string) =>
  names.length === 0 ? (
    none
  ) : (
    <ul className="flex flex-col gap-0.5">
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );

function ProgramDetail({ program }: { program: DiscountProgram }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('pricing.manage');
  const mutations = usePricingMutations();
  const action = useAction();
  const text = useProgramText();
  const names = useProgramNames(program);
  const [confirm, setConfirm] = useState<DetailAct | null>(null);
  const none = t('common.none');
  const running = program.status === 'ACTIVE' || program.status === 'SCHEDULED';

  const run = async () => {
    if (!confirm) return;
    const kind = confirm;
    const ok = await action.run(() => {
      switch (kind) {
        case 'delete':
          return mutations.deleteProgram.mutateAsync(program.id);
        case 'stop':
          return mutations.stopProgram.mutateAsync(program.id);
        case 'archive':
          return mutations.archiveProgram.mutateAsync(program.id);
        case 'restore':
          return mutations.restoreProgram.mutateAsync(program.id);
      }
    });
    if (!ok) return;
    setConfirm(null);
    toast.success(t(`pricing.programs.done.${kind}`));
    if (kind === 'delete') void navigate('/pricing/discounts');
  };

  const places: { label: string; value: ReactNode }[] = [
    ...(program.list === 'RETAIL'
      ? []
      : [
          {
            label: t('pricing.programs.fields.pipelines'),
            value: listed(names.pipelines, t('pricing.programs.everyPipeline')),
          },
        ]),
    ...(program.list === 'WHOLESALE'
      ? []
      : [
          {
            label: t('pricing.programs.fields.tills'),
            value: listed(names.tills, t('pricing.programs.everyTill')),
          },
        ]),
  ];
  const excludes: { label: string; value: ReactNode }[] =
    program.targetKind && program.targetKind !== 'PRODUCT'
      ? [
          {
            label: t(`pricing.programs.fields.excludeTargets.${program.targetKind}`),
            value: listed(names.excludedTargets, none),
          },
          {
            label: t('pricing.programs.fields.excludeProducts'),
            value: listed(names.excludedProducts, none),
          },
        ]
      : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={program.name}
        meta={
          <>
            <ProgramStatusBadge status={program.status} />
            <Badge variant="outline">{t(`pricing.lists.${program.list}`)}</Badge>
            {program.priority ? (
              <Badge variant="outline">{t('pricing.programs.fields.priority')}</Badge>
            ) : null}
            <span className="font-mono">{text.period(program)}</span>
          </>
        }
        actions={
          canManage ? (
            <>
              {running ? (
                <Button variant="outline" onClick={() => setConfirm('stop')}>
                  {t('pricing.programs.stop')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => setConfirm(program.status === 'ARCHIVED' ? 'restore' : 'archive')}
              >
                {t(
                  program.status === 'ARCHIVED'
                    ? 'pricing.programs.restore'
                    : 'pricing.programs.archive',
                )}
              </Button>
              <Button variant="destructive" onClick={() => setConfirm('delete')}>
                {t('pricing.programs.delete')}
              </Button>
              <Button variant="secondary" asChild>
                <Link to={`/pricing/discounts/${program.id}/edit`}>
                  <Pencil />
                  {t('common.edit')}
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <ProblemAlert problem={confirm ? null : action.problem} />
      <Card>
        <CardHeader>
          <CardTitle>{t('pricing.programs.sectionWhat')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldList
            items={[
              { label: t('pricing.programs.columns.apply'), value: text.target(program) },
              ...(program.targetKind
                ? [
                    {
                      label: t(`pricing.programs.fields.targets.${program.targetKind}`),
                      value: listed(names.targets, none),
                    },
                  ]
                : []),
              ...excludes,
              ...(program.scope === 'ORDER'
                ? []
                : [
                    {
                      label: t('pricing.programs.fields.count'),
                      value: t(
                        program.scope === 'CATEGORY'
                          ? 'pricing.programs.counts.TOGETHER'
                          : 'pricing.programs.counts.EACH',
                      ),
                    },
                  ]),
              ...places,
              {
                label: t('pricing.programs.fields.effect'),
                value: t(`pricing.programs.effects.${program.effect}`),
              },
              {
                label: t('pricing.programs.fields.steps'),
                value: (
                  <ul className="flex flex-col gap-0.5">
                    {program.steps.map((step) => (
                      <li key={step.threshold} className="font-mono">
                        {text.step(program, step)}
                      </li>
                    ))}
                  </ul>
                ),
              },
              ...(program.adjustKind === 'NONE'
                ? []
                : [
                    {
                      label: t('pricing.programs.fields.adjust'),
                      value:
                        program.adjustKind === 'ENDS_9'
                          ? t(nineFactorKey(String(program.adjustFactor)))
                          : `${t(`pricing.programs.adjusts.${program.adjustKind}`)} · ${t(
                              'pricing.programs.roundFactor',
                              { factor: program.adjustFactor },
                            )}`,
                    },
                  ]),
              {
                label: t('pricing.programs.columns.period'),
                value: <span className="font-mono">{text.period(program)}</span>,
              },
              {
                label: t('pricing.programs.columns.createdBy'),
                value: program.createdByName ?? none,
              },
              {
                label: t('pricing.programs.columns.createdAt'),
                value: (
                  <span className="font-mono">
                    {formatUbDateTime(Date.parse(program.createdAt))}
                  </span>
                ),
              },
              {
                label: t('pricing.programs.columns.updatedAt'),
                value: (
                  <span className="font-mono">
                    {formatUbDateTime(Date.parse(program.updatedAt))}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        title={t(`pricing.programs.confirm.${confirm ?? 'archive'}.title`, { name: program.name })}
        description={t(`pricing.programs.confirm.${confirm ?? 'archive'}.description`)}
        confirmLabel={t(`pricing.programs.${confirm ?? 'archive'}`)}
        {...(confirm === 'delete' || confirm === 'stop' ? { variant: 'destructive' as const } : {})}
        pending={
          mutations.stopProgram.isPending ||
          mutations.deleteProgram.isPending ||
          mutations.archiveProgram.isPending ||
          mutations.restoreProgram.isPending
        }
        problem={action.problem}
        onConfirm={() => void run()}
        onClose={() => {
          action.clear();
          setConfirm(null);
        }}
      />
    </div>
  );
}
