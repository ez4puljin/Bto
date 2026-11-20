import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { unwrap } from '../api/problem';
import { useSignedIn } from '../state/session';

// «Миний цалин» (ADR-0235): the person's own approved payslips and pay terms, and the scorer's
// KPI scoring. One request per screen; every write refreshes `['payroll']`.

export type Payslip = components['schemas']['PayrollPayslip'];
export type PayslipItem = components['schemas']['PayrollPayslipItem'];
export type MyTerms = components['schemas']['PayrollMyTerms'];
export type ScoringRun = components['schemas']['PayrollScoringRun'];
export type Scoring = components['schemas']['PayrollScoring'];
export type ScoringLine = components['schemas']['PayrollScoringLine'];
export type ScoreEntry = components['schemas']['PayrollScoreEntry'];

/** The approved payslips, newest month first, each whole: the list and a payslip share it. */
export function useMyPayslips() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['payroll', 'payslips'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/payroll/me/payslips')),
    staleTime: 60_000,
    refetchOnMount: true,
  });
}

/** The current fixed salary and the KPI items the person is scored on. */
export function useMyTerms() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['payroll', 'terms'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/payroll/me/terms')),
    staleTime: 60_000,
    refetchOnMount: true,
  });
}

/** The runs a scorer can open, with how many manual items wait for a score. */
export function useScoringRuns(enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['payroll', 'scoring', 'runs'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/payroll/scoring/runs')),
    staleTime: 15_000,
    refetchOnMount: true,
    enabled,
  });
}

/** One run's manual items per employee (no money). */
export function useScoring(id: number, enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['payroll', 'scoring', 'run', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/payroll/scoring/runs/{id}', {
          params: { path: { id } },
        }),
      ),
    staleTime: 15_000,
    enabled,
  });
}

/** Saves scores; the answer is the run's fresh scoring, put straight into the cache. */
export function useSaveScores(id: number) {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scores: ScoreEntry[]) =>
      unwrap(
        await session.client.PUT('/api/v1/payroll/scoring/runs/{id}/scores', {
          params: { path: { id } },
          body: { scores },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['payroll', 'scoring', 'run', id], data);
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'scoring', 'runs'] });
    },
  });
}
