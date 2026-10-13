import { BadgePercent, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
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
    status === 'ACTIVE' ? 'success' : status === 'SCHEDULED' ? 'default' : 'secondary';
  return <Badge variant={variant}>{t(`pricing.programs.status.${status}`)}</Badge>;
}

/** The status filter as a segmented control (ADR-0042); still tabs for keyboards and tests. */
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
    <div>
      <PageHeader
        title={t('pricing.programs.title')}
        meta={<p className="max-w-3xl">{t('pricing.programs.intro')}</p>}
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
      <FilterBar>
        <SegmentedControl
          options={FILTERS}
          label={(value) => t(`pricing.programs.filters.${value}`)}
          value={filter}
          onChange={(value) =>
            setParams(value === 'ACTIVE' ? {} : { status: value }, { replace: true })
          }
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(programs.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.programs.columns.name')}</TableHead>
              <TableHead>{t('pricing.programs.columns.list')}</TableHead>
              <TableHead>{t('pricing.programs.columns.scope')}</TableHead>
              <TableHead>{t('pricing.programs.columns.effect')}</TableHead>
              <TableHead>{t('pricing.programs.columns.steps')}</TableHead>
              <TableHead>{t('pricing.programs.columns.period')}</TableHead>
              <TableHead>{t('pricing.programs.columns.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {programs.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((program) => (
              <LinkRow key={program.id} to={`/pricing/discounts/${program.id}`}>
                <TableCell className="whitespace-normal">
                  <Link
                    to={`/pricing/discounts/${program.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {program.name}
                  </Link>
                </TableCell>
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
                <TableCell className="font-mono">{text.period(program)}</TableCell>
                <TableCell>
                  <ProgramStatusBadge status={program.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!programs.isPending && rows.length === 0 ? (
          <EmptyState icon={BadgePercent} title={t('pricing.programs.empty')} />
        ) : null}
        <LoadMore query={programs} />
      </ListCard>
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
        meta={
          <>
            <ProgramStatusBadge status={program.status} />
            <Badge variant="outline">{t(`pricing.lists.${program.list}`)}</Badge>
            <span className="font-mono">{text.period(program)}</span>
          </>
        }
        actions={
          // An ended program has nothing left to change.
          canManage && program.status !== 'ENDED' ? (
            <>
              {scheduled ? (
                <Button variant="outline" asChild>
                  <Link to={`/pricing/discounts/${program.id}/edit`}>
                    <Pencil />
                    {t('common.edit')}
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setConfirm('stop')}>
                {t('pricing.programs.stop')}
              </Button>
              {scheduled ? (
                <Button variant="destructive" onClick={() => setConfirm('delete')}>
                  {t('pricing.programs.delete')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
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
