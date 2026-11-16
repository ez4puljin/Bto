import { businessDate } from '@tugeel/shared/time';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DATE, monthStart } from '../report-helpers';
import type { Precision } from './book-format';

/**
 * A report's prompt kept in the address (`?from&to&…`), so a reload, a link or the back button
 * shows the same report. `ready` once both dates are valid; `apply` replaces every parameter.
 */
export function useBookParams() {
  const [search, setSearch] = useSearchParams();
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const ready = DATE.test(from) && DATE.test(to) && from <= to;
  const precision: Precision = search.get('p') === '0' ? '0' : '2';
  const apply = useCallback(
    (params: Record<string, string | readonly string[] | number | boolean | null | undefined>) => {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '' || value === false) continue;
        if (Array.isArray(value)) for (const item of value) next.append(key, String(item));
        else next.set(key, String(value));
      }
      setSearch(next);
    },
    [setSearch],
  );
  /** Changes some parameters in place (the live conditions; no new history entry). */
  const update = useCallback(
    (params: Record<string, string | readonly string[] | number | null | undefined>) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(params)) {
            next.delete(key);
            if (value === null || value === undefined || value === '') continue;
            if (Array.isArray(value)) for (const item of value) next.append(key, String(item));
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );
  return { search, from, to, ready, precision, apply, update };
}

/** Positive whole numbers of a repeated parameter. */
export function idsParam(search: URLSearchParams, key: string): number[] {
  return search
    .getAll(key)
    .filter((value) => /^[1-9]\d{0,14}$/.test(value))
    .map((value) => Number.parseInt(value, 10));
}

export function idParamOf(search: URLSearchParams, key: string): number | undefined {
  return idsParam(search, key)[0];
}

/** The prompt's dates as typed, the current month to today by default. */
export function usePromptDates(from: string, to: string) {
  const [start, setStart] = useState(from || monthStart());
  const [end, setEnd] = useState(to || businessDate());
  const valid = DATE.test(start) && DATE.test(end) && start <= end;
  return { start, setStart, end, setEnd, valid };
}

/**
 * Which rows show their detail (a row's key in the set), kept in the address (`?o=`, replaced in
 * place): coming back to the report from a document shows it as it was left. A new prompt drops it.
 */
export function useDrill() {
  const [search, setSearch] = useSearchParams();
  const open = useMemo<ReadonlySet<string>>(() => new Set(search.getAll(DRILL)), [search]);
  const toggle = useCallback(
    (key: string) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          const keys = next.getAll(DRILL);
          next.delete(DRILL);
          for (const item of keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]) {
            next.append(DRILL, item);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );
  const reset = useCallback(
    () =>
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(DRILL);
          return next;
        },
        { replace: true },
      ),
    [setSearch],
  );
  return { open, toggle, reset };
}

const DRILL = 'o';
