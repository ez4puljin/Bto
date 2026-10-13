import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordActionsHead, RecordRow } from '@/components/record-row';
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
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import {
  type DiscountProgram,
  type ProgramStatus,
  useDiscountProgram,
  useDiscountPrograms,
  usePricingMutations,
} from './api';
import { useProgramText } from './program-text';

const FILTERS = ['ACTIVE', 'SCHEDULED', 'ENDED', 'ALL'] as const;
type Filter = (typeof FILTERS)[number];

export function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'ACTIVE' ? 'default' : status === 'SCHEDULED' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`pricing.programs.status.${status}`)}</Badge>;
}

/** «Үнэ» → «Хямдрал»: programs in force by default, newest first (ADR-0041 #2). */
export function DiscountProgramsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.manage');
  const [params, setParams] = useSearchParams();
  const requested = params.get('status');
  const filter: Filter = FILTERS.find((value) => value === requested) ?? 'ACTIVE';
  const programs = useDiscountPrograms({ status: filter === 'ALL' ? undefined : filter });
  const text = useProgramText();
  const rows = programs.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('pricing.programs.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/pricing/discounts/new">{t('pricing.programs.new')}</Link>
            </Button>
          ) : undefined
        }
      />
      <p className="-mt-2 max-w-3xl text-sm text-muted-foreground">{t('pricing.programs.intro')}</p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={filter === value}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
            onClick={() =>
              setParams(value === 'ACTIVE' ? {} : { status: value }, { replace: true })
            }
          >
            {t(`pricing.programs.filters.${value}`)}
          </Button>
        ))}
      </div>
      <ProblemAlert problem={problemFromError(programs.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <RecordActionsHead />
            <TableHead>{t('pricing.programs.columns.name')}</TableHead>
            <TableHead>{t('pricing.programs.columns.list')}</TableHead>
            <TableHead>{t('pricing.programs.columns.scope')}</TableHead>
            <TableHead>{t('pricing.programs.columns.effect')}</TableHead>
            <TableHead>{t('pricing.programs.columns.steps')}</TableHead>
            <TableHead>{t('pricing.programs.columns.period')}</TableHead>
            <TableHead>{t('pricing.programs.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((program) => (
            <RecordRow
              key={program.id}
              href={`/pricing/discounts/${program.id}`}
              name={program.name}
              canManage={canManage && program.status === 'SCHEDULED'}
            >
              <TableCell className="font-medium whitespace-normal">{program.name}</TableCell>
              <TableCell>{t(`pricing.lists.${program.list}`)}</TableCell>
              <TableCell className="whitespace-normal">{text.target(program)}</TableCell>
              <TableCell>{t(`pricing.programs.effects.${program.effect}`)}</TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-col">
                  {program.steps.map((step) => (
                    <span key={step.threshold}>{text.step(program, step)}</span>
                  ))}
                </div>
              </TableCell>
              <TableCell>{text.period(program)}</TableCell>
              <TableCell>
                <ProgramStatusBadge status={program.status} />
              </TableCell>
            </RecordRow>
          ))}
        </TableBody>
      </Table>
      {!programs.isPending && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pricing.programs.empty')}</p>
      ) : null}
      {programs.hasNextPage ? (
        <Button
          className="self-start"
          variant="outline"
          disabled={programs.isFetchingNextPage}
          onClick={() => void programs.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** One program: what it discounts and its steps; edit and delete before it starts, stop after. */
export function DiscountProgramPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const program = useDiscountProgram(id);
  const loadProblem = problemFromError(program.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!program.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return <ProgramDetail program={program.data} />;
}

function ProgramDetail({ program }: { program: DiscountProgram }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('pricing.manage');
  const mutations = usePricingMutations();
  const action = useAction();
  const text = useProgramText();
  const [confirm, setConfirm] = useState<'stop' | 'delete' | null>(null);
  const scheduled = program.status === 'SCHEDULED';

  const run = async () => {
    const ok = await action.run(() =>
      confirm === 'delete'
        ? mutations.deleteProgram.mutateAsync(program.id)
        : mutations.stopProgram.mutateAsync(program.id),
    );
    if (!ok) return;
    setConfirm(null);
    if (confirm === 'delete') void navigate('/pricing/discounts');
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={program.name}
        actions={
          <>
            {canManage && scheduled ? (
              <Button variant="outline" asChild>
                <Link to={`/pricing/discounts/${program.id}/edit`}>{t('common.edit')}</Link>
              </Button>
            ) : null}
            {canManage && program.status !== 'ENDED' ? (
              <Button variant="outline" onClick={() => setConfirm('stop')}>
                {t('pricing.programs.stop')}
              </Button>
            ) : null}
            {canManage && scheduled ? (
              <Button variant="outline" onClick={() => setConfirm('delete')}>
                {t('pricing.programs.delete')}
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link to="/pricing/discounts">{t('common.back')}</Link>
            </Button>
          </>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
        <ProgramStatusBadge status={program.status} />
        <Badge variant="outline">{t(`pricing.lists.${program.list}`)}</Badge>
        <span className="text-muted-foreground">{text.period(program)}</span>
      </div>
      {canManage && program.status === 'ACTIVE' ? (
        <p className="text-sm text-muted-foreground">{t('pricing.programs.startedHint')}</p>
      ) : null}
      <ProblemAlert problem={confirm ? null : action.problem} />
      <Card>
        <CardHeader>
          <CardTitle>{text.target(program)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            {t('pricing.programs.fields.effect')}: {t(`pricing.programs.effects.${program.effect}`)}
          </p>
          <ul className="flex flex-col gap-1">
            {program.steps.map((step) => (
              <li key={step.threshold} className="font-mono">
                {text.step(program, step)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        title={t(
          confirm === 'delete' ? 'pricing.programs.deleteTitle' : 'pricing.programs.stopTitle',
        )}
        description={t(
          confirm === 'delete'
            ? 'pricing.programs.deleteDescription'
            : 'pricing.programs.stopDescription',
        )}
        confirmLabel={t(confirm === 'delete' ? 'pricing.programs.delete' : 'pricing.programs.stop')}
        variant="destructive"
        pending={mutations.stopProgram.isPending || mutations.deleteProgram.isPending}
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
