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
  // ADR-0111: bank transfers at the till, until the accountant matches them with the statement.
  'TRANSFER_CLEARING',
  'POS_SALES',
  'CASH_VARIANCE',
  // Payables (F3, ADR-0091): what the company owes its suppliers, the VAT inside its purchases,
  // and the stock a supplier's bill pays for. The codes are temporary until Erkhet's chart (D16).
  'AP',
  'VAT_INPUT',
  'INVENTORY',
  // Stock and cost (F4, ADR-0097): the clearing of goods received before their bill, the cost of
  // goods sold, shortages and surpluses, the opening stock's offset, and one account per goods-issue
  // expense type. Temporary codes until Erkhet's chart (D16); the rules are TODO-VERIFY D8.
  'GOODS_RECEIVED',
  'COGS',
  'STOCK_LOSS',
  'STOCK_GAIN',
  'OPENING_STOCK',
  'ISSUE_INTERNAL',
  'ISSUE_BONUS',
  'ISSUE_MARKETING',
  'ISSUE_WRITE_OFF',
  'ISSUE_TRANSFER_OUT',
  'ISSUE_OTHER',
  // The year close (F6, ADR-0105): income and expense closed into it. Temporary code until D16.
  'RETAINED_EARNINGS',
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
  { code: '120302', kind: 'ASSET', role: 'TRANSFER_CLEARING' },
  { code: '510102', kind: 'INCOME', role: 'POS_SALES' },
  { code: '740101', kind: 'EXPENSE', role: 'CASH_VARIANCE' },
  // Payables (F3, ADR-0091; temporary codes, TODO-VERIFY D16).
  { code: '130301', kind: 'ASSET', role: 'VAT_INPUT' },
  { code: '140101', kind: 'ASSET', role: 'INVENTORY' },
  { code: '310101', kind: 'LIABILITY', role: 'AP' },
  // Stock and cost (F4, ADR-0097; temporary codes, TODO-VERIFY D8 / D16).
  { code: '310201', kind: 'LIABILITY', role: 'GOODS_RECEIVED' },
  { code: '610101', kind: 'EXPENSE', role: 'COGS' },
  { code: '740201', kind: 'EXPENSE', role: 'STOCK_LOSS' },
  { code: '511030', kind: 'INCOME', role: 'STOCK_GAIN' },
  { code: '390101', kind: 'EQUITY', role: 'OPENING_STOCK' },
  { code: '730201', kind: 'EXPENSE', role: 'ISSUE_INTERNAL' },
  { code: '730202', kind: 'EXPENSE', role: 'ISSUE_BONUS' },
  { code: '730203', kind: 'EXPENSE', role: 'ISSUE_MARKETING' },
  { code: '730204', kind: 'EXPENSE', role: 'ISSUE_WRITE_OFF' },
  { code: '730205', kind: 'EXPENSE', role: 'ISSUE_TRANSFER_OUT' },
  { code: '730209', kind: 'EXPENSE', role: 'ISSUE_OTHER' },
  // The year close (F6, ADR-0105; a temporary code, TODO-VERIFY D16).
  { code: '340101', kind: 'EQUITY', role: 'RETAINED_EARNINGS' },
];
