import { isErrorCode } from '@tugeel/shared/errors';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { edgeProblemOf } from './edge-client';

type Params = Record<string, string | number | boolean>;

function primitives(params: Record<string, unknown> | undefined): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The Mongolian line for a failed edge call: `errors.<CODE>` with its params, a line of its own
 * when the edge did not answer, a generic one for a code the kiosk does not know.
 */
export function useProblemText(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const problem = edgeProblemOf(error);
      if (problem.code === 'NETWORK') return t('posKiosk.errors.network');
      if (isErrorCode(problem.code)) return t(`errors.${problem.code}`, primitives(problem.params));
      return t('posKiosk.errors.generic');
    },
    [t],
  );
}
