import { IMPORT_COLUMNS, IMPORT_KINDS, type ImportKind } from '@tugeel/shared/imports';
import { Download, FileSpreadsheet, ListChecks, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError, problemOf } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type ImportJob,
  type ImportRow,
  type ImportStatus,
  RUNNING,
  type RowFilter,
  useImport,
  useImportMutations,
  useImportRows,
  useImports,
} from './api';
import { columnName, fieldNames, issueText } from './helpers';

const FILTERS: readonly RowFilter[] = ['ERRORS', 'WARNINGS', 'ALL'];
/** Filled cells shown for each row before the ones with a problem. */
const SHOWN_CELLS = 3;

function StatusBadge({ status }: { status: ImportStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'COMMITTED' || status === 'VALIDATED'
      ? 'success'
      : status === 'INVALID' || status === 'FAILED'
        ? 'destructive'
        : RUNNING.includes(status)
          ? 'default'
          : 'outline';
  return <Badge variant={variant}>{t(`imports.statuses.${status}`)}</Badge>;
}

/** The rows filter as a segmented control (ADR-0042); still tabs for keyboards and tests. */
/** Imports (ADR-0036): a card per kind for the template and the upload, then the history. */
export function ImportsPage() {
  const { t } = useTranslation();
  const imports = useImports();
  const rows = imports.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader
        title={t('imports.title')}
        meta={<p className="max-w-3xl">{t('imports.intro')}</p>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {IMPORT_KINDS.map((kind) => (
          <ImportKindCard key={kind} kind={kind} />
        ))}
      </div>
      <h2 className="mt-8 mb-3 text-[17px] leading-tight font-semibold tracking-tight">
        {t('imports.history')}
      </h2>
      <ProblemAlert problem={problemFromError(imports.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('imports.fileName')}</TableHead>
              <TableHead>{t('imports.kind')}</TableHead>
              <TableHead className="text-right">{t('imports.rows')}</TableHead>
              <TableHead>{t('imports.createdAt')}</TableHead>
              <TableHead>{t('imports.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((job) => (
              <LinkRow key={job.id} to={`/imports/${job.id}`}>
                <TableCell className="whitespace-normal">
                  <Link
                    to={`/imports/${job.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {job.fileName}
                  </Link>
                </TableCell>
                <TableCell>{t(`imports.kinds.${job.kind}`)}</TableCell>
                <TableCell className="text-right font-mono">{job.totalRows}</TableCell>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(job.createdAt))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!imports.isPending && rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title={t('imports.empty')} />
        ) : null}
        <LoadMore query={imports} />
      </ListCard>
    </div>
  );
}

function ImportKindCard({ kind }: { kind: ImportKind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useImportMutations();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(randomUuid);
  const [wrongType, setWrongType] = useState(false);

  const download = () =>
    void action.run(async () => {
      const blob = await mutations.template.mutateAsync(kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tugeel-${kind.toLowerCase().replace(/_/g, '-')}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    });

  const upload = (file: File) =>
    void action.run(async () => {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setWrongType(true);
        return;
      }
      setWrongType(false);
      const job = await mutations.create.mutateAsync({ kind, file, key });
      setKey(randomUuid());
      await navigate(`/imports/${job.id}`);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`imports.kinds.${kind}`)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t(`imports.kindHints.${kind}`)}</p>
        {wrongType ? <p className="text-sm text-destructive">{t('imports.xlsxOnly')}</p> : null}
        <ProblemAlert problem={action.problem} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={mutations.template.isPending} onClick={download}>
            <Download />
            {t('imports.downloadTemplate')}
          </Button>
          <Button disabled={mutations.create.isPending} onClick={() => input.current?.click()}>
            <Upload />
            {t('imports.upload')}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            aria-label={`${t('imports.upload')}: ${t(`imports.kinds.${kind}`)}`}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) upload(file);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** One import: progress while the worker runs, the counts, the rows with their problems. */
export function ImportPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const job = useImport(id);
  const [filter, setFilter] = useState<RowFilter | null>(null);

  const loadProblem = problemFromError(job.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!job.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = job.data;
  const running = RUNNING.includes(detail.status);
  const shown = filter ?? (detail.errorRows > 0 ? 'ERRORS' : 'ALL');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.fileName}
        meta={
          <>
            <StatusBadge status={detail.status} />
            <Badge variant="outline">{t(`imports.kinds.${detail.kind}`)}</Badge>
            <span className="font-mono">{formatUbDateTime(Date.parse(detail.createdAt))}</span>
          </>
        }
      />
      {running ? <Progress job={detail} /> : null}
      <JobSummary job={detail} />
      {!running ? <JobActions job={detail} /> : null}
      {detail.totalRows > 0 && detail.summary?.rowsPruned ? (
        <p className="text-sm text-muted-foreground">{t('imports.rowsPruned')}</p>
      ) : detail.totalRows > 0 ? (
        <div>
          <FilterBar>
            <SegmentedControl
              options={FILTERS}
              value={shown}
              label={(value) => t(`imports.filters.${value}`)}
              onChange={setFilter}
            />
          </FilterBar>
          <RowsTable job={detail} filter={shown} />
        </div>
      ) : null}
    </div>
  );
}

function Progress({ job }: { job: ImportJob }) {
  const { t } = useTranslation();
  const total = Math.max(job.totalRows, 1);
  const share = Math.min(100, Math.round((job.processedRows / total) * 100));
  return (
    <div className="flex flex-col gap-1" role="status">
      <span className="text-sm">
        {job.phase
          ? t(`imports.phases.${job.phase as 'PARSING'}`)
          : t(`imports.statuses.${job.status}`)}
        {job.totalRows > 0
          ? ` ${t('imports.progress', { done: job.processedRows, total: job.totalRows })}`
          : null}
      </span>
      <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-fill">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

function JobSummary({ job }: { job: ImportJob }) {
  const { t } = useTranslation();
  const actions = job.summary?.actions ?? {};
  const problem = job.lastError
    ? problemOf({ type: 'about:blank', title: job.lastError.code, status: 409, ...job.lastError })
    : null;
  return (
    <div className="flex flex-col gap-2">
      {(job.summary?.fileIssues ?? []).map((issue) => (
        <Alert key={issue.code} variant="destructive">
          <AlertDescription>
            {t(`imports.fileIssues.${issue.code as 'EMPTY'}`, issue.params ?? {})}
          </AlertDescription>
        </Alert>
      ))}
      {job.summary?.refreshed ? (
        <Alert>
          <AlertDescription>{t('imports.refreshed')}</AlertDescription>
        </Alert>
      ) : problem && problem.code !== 'IMPORT_STATE_INVALID' ? (
        <ProblemAlert problem={problem} />
      ) : null}
      {job.totalRows > 0 ? (
        <p className="text-sm">
          {t('imports.counts', {
            total: job.totalRows,
            create: actions.CREATE ?? 0,
            update: actions.UPDATE ?? 0,
            unchanged: actions.UNCHANGED ?? 0,
          })}
        </p>
      ) : null}
      {job.errorRows > 0 ? (
        <p className="text-sm font-medium text-destructive">
          {t('imports.errorRows', { count: job.errorRows })}
        </p>
      ) : null}
      {job.warningRows > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('imports.warningRows', { count: job.warningRows })}
        </p>
      ) : null}
      {job.status === 'INVALID' ? (
        <p className="text-sm text-muted-foreground">{t('imports.invalidHint')}</p>
      ) : null}
    </div>
  );
}

function JobActions({ job }: { job: ImportJob }) {
  const { t } = useTranslation();
  const mutations = useImportMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'commit' | 'revert' | null>(null);
  const [key, setKey] = useState(randomUuid);
  const run = (step: 'commit' | 'revert') =>
    void action.run(async () => {
      await (step === 'commit' ? mutations.commit : mutations.revert).mutateAsync({
        id: job.id,
        key,
      });
      setConfirm(null);
    });
  const open = (step: 'commit' | 'revert') => {
    setKey(randomUuid());
    action.clear();
    setConfirm(step);
  };
  // A refused, failed or reverted import has nothing left to do: no empty gap on the page.
  if (job.status !== 'VALIDATED' && job.status !== 'COMMITTED') return null;

  return (
    <div className="flex flex-col gap-2">
      <ProblemAlert problem={confirm ? null : action.problem} />
      <div className="flex flex-wrap items-center gap-2">
        {job.status === 'VALIDATED' ? (
          <Button onClick={() => open('commit')}>{t('imports.commit')}</Button>
        ) : null}
        {job.status === 'COMMITTED' ? (
          <Button variant="outline" disabled={!job.canRevert} onClick={() => open('revert')}>
            {t('imports.revert')}
          </Button>
        ) : null}
        {job.status === 'COMMITTED' && !job.canRevert ? (
          <span className="text-sm text-muted-foreground">{t('imports.revertOnlyLatest')}</span>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm === 'commit'}
        variant="default"
        title={t('imports.commitTitle')}
        description={t('imports.commitDescription', { count: job.totalRows })}
        confirmLabel={t('imports.commit')}
        pending={mutations.commit.isPending}
        problem={action.problem}
        onConfirm={() => run('commit')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'revert'}
        title={t('imports.revertTitle')}
        description={t('imports.revertDescription')}
        confirmLabel={t('imports.revert')}
        pending={mutations.revert.isPending}
        problem={action.problem}
        onConfirm={() => run('revert')}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function RowsTable({ job, filter }: { job: ImportJob; filter: RowFilter }) {
  const { t } = useTranslation();
  const rows = useImportRows(job.id, filter, job.validatedAt ?? undefined);
  const data = rows.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <ProblemAlert problem={problemFromError(rows.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">{t('imports.rowNo')}</TableHead>
              <TableHead>{t('imports.row')}</TableHead>
              <TableHead>{t('imports.result')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* isLoading, not isPending: before the first check the rows query waits, idle. */}
            {rows.isLoading ? <SkeletonRows columns={3} /> : null}
            {data.map((row) => (
              <TableRow key={row.rowNo}>
                <TableCell className="text-right align-top font-mono">{row.rowNo}</TableCell>
                <TableCell className="align-top whitespace-normal">
                  <RowCells job={job} row={row} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <RowResult job={job} row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.isPending && data.length === 0 ? (
          <EmptyState icon={ListChecks} title={t('imports.noRows')} />
        ) : null}
        <LoadMore query={rows} />
      </ListCard>
    </>
  );
}

/**
 * The first filled cells of a row in template order, plus every cell with a problem, so the
 * owner recognises the row in the sheet.
 */
function RowCells({ job, row }: { job: ImportJob; row: ImportRow }) {
  const { t } = useTranslation();
  const flagged = new Set([...row.errors, ...row.warnings].map((issue) => issue.column));
  const filled = IMPORT_COLUMNS[job.kind]
    .map(({ key }) => key)
    .filter((key) => row.raw[key] !== undefined && row.raw[key] !== null);
  return (
    <span className="text-sm">
      {filled
        .filter((key, at) => at < SHOWN_CELLS || flagged.has(key))
        .map((key) => t('imports.cell', { column: columnName(job.kind, key), value: row.raw[key] }))
        .join(' · ')}
    </span>
  );
}

function RowResult({ job, row }: { job: ImportJob; row: ImportRow }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 text-sm">
      {row.action ? (
        <span>
          <Badge variant={row.action === 'UNCHANGED' ? 'outline' : 'secondary'}>
            {t(`imports.actions.${row.action}`)}
          </Badge>
          {row.action === 'UPDATE' && row.changed.length > 0 ? (
            <span className="ml-2 text-muted-foreground">
              {t('imports.changedFields', { fields: fieldNames(job.kind, row.changed) })}
            </span>
          ) : null}
        </span>
      ) : null}
      {row.errors.map((issue, index) => (
        <span key={`e${index}`} className="text-destructive">
          {issueText(t, job.kind, issue)}
        </span>
      ))}
      {row.warnings.map((issue, index) => (
        <span key={`w${index}`} className="text-muted-foreground">
          {issueText(t, job.kind, issue)}
        </span>
      ))}
    </div>
  );
}
