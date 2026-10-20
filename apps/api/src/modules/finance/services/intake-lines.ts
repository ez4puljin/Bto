import type { LineV1 } from '@tugeel/fin-contract';
import type { GlRole } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { POSTING_KEY_OF_ROLE } from '../../fin-bridge';

/** One line of a Bto document's posting, by chart role (ADR-0060 #7), before the intake's shape. */
export interface RoleLine {
  role: GlRole;
  debit: Decimal;
  credit: Decimal;
  /** A tax line's base (the net it was taken from). */
  taxBase?: Decimal;
  /** Extra fields of the contract's line (the receivable's item, what it settles). */
  extra?: Partial<Pick<LineV1, 'openItem' | 'settles' | 'moneyAccount' | 'accountCode' | 'party'>>;
}

/** The tax codes Bto's lines carry (ADR-0074; the city code per activity is TODO-VERIFY). */
export const TAX_CODE_OF_ROLE: Partial<Record<GlRole, string>> = {
  VAT_PAYABLE: 'MN.VAT.STD',
  CITY_TAX_PAYABLE: 'MN.CITY.STD',
  VAT_INPUT: 'MN.VAT.STD',
};

/** Role lines as the intake's lines: the posting key of each role, the side, the amount. */
export function intakeLines(lines: readonly RoleLine[]): LineV1[] {
  return lines.map((line, index) => {
    const debit = line.debit.gt(0);
    const amount = (debit ? line.debit : line.credit).toFixed(2);
    const taxCode = TAX_CODE_OF_ROLE[line.role];
    return {
      lineNo: index + 1,
      key: POSTING_KEY_OF_ROLE[line.role].code,
      side: debit ? ('DEBIT' as const) : ('CREDIT' as const),
      amount,
      ...(taxCode && line.taxBase
        ? { tax: { code: taxCode, base: line.taxBase.toFixed(2), lineCount: 1 } }
        : {}),
      ...line.extra,
    };
  });
}

/** Σ debit of role lines: the document's control total. */
export function controlTotal(lines: readonly RoleLine[]): string {
  return lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0)).toFixed(2);
}
