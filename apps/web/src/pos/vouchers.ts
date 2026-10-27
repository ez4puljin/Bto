import {
  type EdgeCartLine,
  formatVoucherCode,
  VOUCHER_LIMITS,
  VOUCHER_REFUSALS,
} from '@tugeel/shared/pos';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { edgeProblemOf } from './edge-client';
import { useKiosk } from './kiosk-context';
import { useProblemText } from './messages';

export type VoucherAdd = { ok: true; codes: string[] } | { ok: false; error: string };

/**
 * Takes a scanned or typed coupon or partner voucher onto the sale (ADR-0110): the edge knows it,
 * and the whole cart quotes with it (a voucher with nothing left to pay is refused there). The
 * refusal comes back in the till's words.
 */
export function useVoucherAdd(): (
  lines: readonly EdgeCartLine[],
  codes: readonly string[],
  typed: string,
) => Promise<VoucherAdd> {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  return useCallback(
    async (lines, codes, typed) => {
      const code = typed.replace(/[\s-]/g, '');
      const shown = formatVoucherCode(code);
      if (codes.includes(code)) {
        return { ok: false, error: t('posKiosk.vouchers.refused.USED', { code: shown }) };
      }
      if (codes.length >= VOUCHER_LIMITS.maxPerSale) {
        return {
          ok: false,
          error: t('posKiosk.vouchers.tooMany', { max: VOUCHER_LIMITS.maxPerSale }),
        };
      }
      try {
        await client.voucher(code);
        await client.quote({ lines: [...lines], codes: [...codes, code] });
        return { ok: true, codes: [...codes, code] };
      } catch (caught) {
        const problem = edgeProblemOf(caught);
        const reason = problem.params?.reason;
        const known =
          problem.code === 'POS_VOUCHER_INVALID'
            ? VOUCHER_REFUSALS.find((refusal) => refusal === reason)
            : undefined;
        return {
          ok: false,
          error: known
            ? t(`posKiosk.vouchers.refused.${known}`, { code: shown })
            : problemText(caught),
        };
      }
    },
    [t, client, problemText],
  );
}
