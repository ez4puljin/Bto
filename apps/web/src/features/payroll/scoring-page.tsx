import { PAYROLL_LIMITS, PAYROLL_PERCENT_PATTERN } from '@tugeel/shared/payroll';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { ClipboardCheck } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState, FilterBar, ListCard, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type PayrollScoring,
  usePayrollMutations,
  useScoring,
  useScoringRuns,
} from './payroll-api';
import { cleanPercent } from './payroll-helpers';

type Draft = { score: string; note: string };

/** The people and their manual items of one run, each with a score field: no amount anywhere. */
function ScoringSheet({ scoring }: { scoring: PayrollScoring }) {
  const { t } = useTranslation();
  const mutations = usePayrollMutations();
  const action = useAction();
  const [query, setQuery] = useState('');
  const items = useMemo(() => scoring.lines.flatMap((line) => line.items), [scoring.lines]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      items.map((item) => [item.itemId, { score: item.scorePercent ?? '', note: item.note ?? '' }]),
    ),
  );
  const [errors, setErrors] = useState<ReadonlySet<number>>(new Set());
  const open = scoring.status === 'DRAFT';
  const changed = items.filter((item) => {
    const draft = drafts[item.itemId];
    return (
      draft !== undefined &&
      (draft.score !== (item.scorePercent ?? '') || draft.note !== (item.note ?? ''))
    );
  });
  const missing = items.filter((item) => item.scorePercent === null).length;
  const lines = useMemo(() => {
    const words = queryTerms(query);
    return scoring.lines.filter(
      (line) =>
        words.length === 0 ||
        matchesQuery(
          searchKeys(line.fullName, [line.position ?? '', line.divisionName ?? '']),
          words,
        ),
    );
  }, [scoring.lines, query]);
  const set = (itemId: number, patch: Partial<Draft>) => {
    setErrors(new Set());
    setDrafts((current) => ({
      ...current,
      [itemId]: { score: '', note: '', ...current[itemId], ...patch },
    }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const bad = new Set(
      changed
        .filter((item) => {
          const score = drafts[item.itemId]?.score ?? '';
          return score !== '' && !PAYROLL_PERCENT_PATTERN.test(score);
        })
        .map((item) => item.itemId),
    );
    setErrors(bad);
    if (bad.size > 0) return;
    const ok = await action.run(() =>
      mutations.saveScores.mutateAsync({
        runId: scoring.runId,
        scores: changed.map((item) => {
          const draft = drafts[item.itemId] ?? { score: '', note: '' };
          return {
            itemId: item.itemId,
            scorePercent: draft.score === '' ? null : draft.score,
            note: draft.note.trim() === '' ? null : draft.note.trim(),
          };
        }),
      }),
    );
    if (ok) toast.success(t('payroll.web.scoring.saved', { count: changed.length }));
  };

  return (
    <form noValidate onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
      <FilterBar
        end={
          <span className="text-[0.8125rem] text-muted-foreground">
            {missing > 0
              ? t('payroll.web.scoring.missing', { count: missing })
              : t('payroll.web.scoring.allScored')}
          </span>
        }
      >
        <SearchField
          className="sm:w-auto sm:max-w-72 sm:min-w-48 sm:flex-1"
          aria-label={t('payroll.web.search')}
          placeholder={t('payroll.web.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </FilterBar>
      <ProblemAlert problem={action.problem} />
      <ListCard>
        {lines.length === 0 ? (
          <EmptyState
            title={
              scoring.lines.length === 0
                ? t('payroll.web.scoring.noItems')
                : t('payroll.web.noMatch')
            }
            icon={ClipboardCheck}
          />
        ) : (
          <ul className="divide-y divide-border/80">
            {lines.map((line) => (
              <li key={line.lineId} className="@container px-4 py-3">
                <div className="grid gap-3 @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[line.position, line.divisionName].filter(Boolean).join(' · ') ||
                        t('common.none')}
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {line.items.map((item) => {
                      const draft = drafts[item.itemId] ?? { score: '', note: '' };
                      return (
                        <li
                          key={item.itemId}
                          className="grid gap-2 @xl:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.2fr)] @xl:items-center"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[0.8125rem]">{item.name}</span>
                            {item.scorePercent === null ? (
                              <Badge variant="warning">{t('payroll.web.line.notScored')}</Badge>
                            ) : null}
                          </span>
                          <div>
                            <Input
                              aria-label={t('payroll.web.scoring.scoreFor', {
                                name: line.fullName,
                                item: item.name,
                              })}
                              inputMode="decimal"
                              className="text-right"
                              placeholder="0–100 %"
                              disabled={!open}
                              aria-invalid={errors.has(item.itemId) ? true : undefined}
                              value={draft.score}
                              onChange={(event) =>
                                set(item.itemId, { score: cleanPercent(event.target.value) })
                              }
                            />
                            {errors.has(item.itemId) ? (
                              <p role="alert" className="mt-1 text-xs text-destructive">
                                {t('validation.percent')}
                              </p>
                            ) : null}
                          </div>
                          <Input
                            aria-label={t('payroll.web.scoring.noteFor', {
                              name: line.fullName,
                              item: item.name,
                            })}
                            placeholder={t('payroll.web.line.note')}
                            maxLength={PAYROLL_LIMITS.maxNote}
                            disabled={!open}
                            value={draft.note}
                            onChange={(event) => set(item.itemId, { note: event.target.value })}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListCard>
      {open && items.length > 0 ? (
        <StickyActions summary={t('payroll.web.scoring.changed', { count: changed.length })}>
          <Button
            type="submit"
            disabled={changed.length === 0}
            pending={mutations.saveScores.isPending}
          >
            {t('payroll.web.scoring.save')}
          </Button>
        </StickyActions>
      ) : null}
    </form>
  );
}

/**
 * «KPI үнэлгээ» (ADR-0235, hr.payroll.score or manage): a manager picks a draft month, sees the
 * employees' work-evaluation items without any amount and enters each score (0–100 %) with a note.
 */
export function PayrollScoringPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const runs = useScoringRuns();
  const drafts = (runs.data ?? []).filter((run) => run.status === 'DRAFT');
  const chosen = Number(search.get('run') ?? '');
  const runId = Number.isInteger(chosen) && chosen > 0 ? chosen : (drafts[0]?.runId ?? null);
  const scoring = useScoring(runId);
  return (
    <div>
      <PageHeader
        title={t('payroll.web.scoring.title')}
        description={t('payroll.web.scoring.description')}
      />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('payroll.web.scoring.run')}
          active={false}
          value={runId === null ? '' : String(runId)}
          disabled={drafts.length === 0}
          onChange={(event) => setParam('run', event.target.value || null)}
        >
          {drafts.length === 0 ? <option value="">{t('payroll.web.scoring.noRuns')}</option> : null}
          {drafts.map((run) => (
            <option key={run.runId} value={run.runId}>
              {t('payroll.web.scoring.runOption', { month: run.month, count: run.unscoredCount })}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert
        problem={problemFromError(runs.error ?? scoring.error)}
        onRetry={() => void (runs.error ? runs.refetch() : scoring.refetch())}
      />
      {runs.data && drafts.length === 0 ? (
        <ListCard>
          <EmptyState title={t('payroll.web.scoring.noRuns')} icon={ClipboardCheck} />
        </ListCard>
      ) : null}
      {scoring.data ? <ScoringSheet key={`${scoring.data.runId}`} scoring={scoring.data} /> : null}
    </div>
  );
}
