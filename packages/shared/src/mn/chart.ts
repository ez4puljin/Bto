/** The kinds of account a chart holds. */
export const ACCOUNT_KINDS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/**
 * What an account of the template is for (ADR-0060 #7, Bto's GL roles; the Finance Core turns them
 * into posting rules, ADR-0072).
 */
export const CHART_ROLES = [
  'AR',
  'SALES',
  'SALES_DISCOUNT',
  'SALES_RETURN',
  'VAT_PAYABLE',
  'CITY_TAX_PAYABLE',
  'CUSTOMER_ADVANCE',
  'CASH',
  'BANK',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
  // The supermarket POS (ADR-0064): the tills' cash until it is handed over, card money until the
  // bank settles it, the store's sales, and what a count missed or found.
  'POS_CASH',
  'CARD_CLEARING',
  'POS_SALES',
  'CASH_VARIANCE',
  // Payables (F3, ADR-0091): what the company owes its suppliers, the VAT inside its purchases,
  // and the stock a supplier's bill pays for. The codes are temporary until Erkhet's chart (D16).
  'AP',
  'VAT_INPUT',
  'INVENTORY',
] as const;
export type ChartRole = (typeof CHART_ROLES)[number];

export interface ChartTemplateAccount {
  code: string;
  kind: AccountKind;
  role: ChartRole | null;
}

/**
 * The chart that fills an empty chart, in Erkhet's numbering style (ADR-0060 #7, ADR-0074 #2): for
 * tests and a new company before its own chart is imported (company BO imports Erkhet's, D16).
 */
export const CHART_TEMPLATE: readonly ChartTemplateAccount[] = [
  { code: '100101', kind: 'ASSET', role: 'CASH' },
  { code: '110101', kind: 'ASSET', role: 'BANK' },
  { code: '120101', kind: 'ASSET', role: 'AR' },
  { code: '311004', kind: 'LIABILITY', role: 'VAT_PAYABLE' },
  { code: '311005', kind: 'LIABILITY', role: 'CITY_TAX_PAYABLE' },
  { code: '320201', kind: 'LIABILITY', role: 'CUSTOMER_ADVANCE' },
  { code: '510101', kind: 'INCOME', role: 'SALES' },
  { code: '511020', kind: 'INCOME', role: 'OTHER_INCOME' },
  { code: '520101', kind: 'INCOME', role: 'SALES_RETURN' },
  { code: '520201', kind: 'INCOME', role: 'SALES_DISCOUNT' },
  { code: '730101', kind: 'EXPENSE', role: 'OTHER_EXPENSE' },
  // The supermarket POS (ADR-0064 #2).
  { code: '100102', kind: 'ASSET', role: 'POS_CASH' },
  { code: '120301', kind: 'ASSET', role: 'CARD_CLEARING' },
  { code: '510102', kind: 'INCOME', role: 'POS_SALES' },
  { code: '740101', kind: 'EXPENSE', role: 'CASH_VARIANCE' },
  // Payables (F3, ADR-0091; temporary codes, TODO-VERIFY D16).
  { code: '130301', kind: 'ASSET', role: 'VAT_INPUT' },
  { code: '140101', kind: 'ASSET', role: 'INVENTORY' },
  { code: '310101', kind: 'LIABILITY', role: 'AP' },
];
