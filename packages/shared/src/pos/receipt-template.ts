/**
 * The till's receipt templates (ADR-0141, owner 2026-11-04): the admin lays a receipt out from
 * blocks in the office, the snapshot carries the published layouts to the edge, and the kiosk
 * draws the receipt from them. A template is of one kind (a sale's or a return's receipt); one of
 * each kind is the default and a POS may pick another. The blocks the law or the books need — the
 * heading with the seller and the banners, the receipt's facts, the lines, the totals with VAT, the
 * payments, the e-Barimt part and a credit slip's signature — are always there exactly once; the
 * admin moves them and sets their options but cannot take them out. The rest is free (ADR-0142):
 * texts with the receipt's values in them, a logo, a QR code, the receipt's barcode, rules and
 * spaces, each printed always or only on some receipts, within dates, or kept hidden. The api, the
 * edge and the web check a layout with `checkReceiptLayout`.
 */

import { luhnDigit } from './vouchers';

export const RECEIPT_TEMPLATE_KINDS = ['SALE', 'RETURN'] as const;
export type ReceiptTemplateKind = (typeof RECEIPT_TEMPLATE_KINDS)[number];

/** The receipt printer's paper: 80 mm (72 mm printed) or 58 mm (48 mm printed). */
export const RECEIPT_PAPERS = ['MM80', 'MM58'] as const;
export type ReceiptPaper = (typeof RECEIPT_PAPERS)[number];

export const RECEIPT_SIZES = ['SM', 'MD', 'LG'] as const;
export type ReceiptSize = (typeof RECEIPT_SIZES)[number];

export const RECEIPT_ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export type ReceiptAlign = (typeof RECEIPT_ALIGNS)[number];

export const RECEIPT_RULES = ['DASHED', 'SOLID', 'DOUBLE'] as const;
export type ReceiptRule = (typeof RECEIPT_RULES)[number];

/** A logo's width, in per cent of the paper. */
export const RECEIPT_LOGO_WIDTHS = [40, 60, 80, 100] as const;
export type ReceiptLogoWidth = (typeof RECEIPT_LOGO_WIDTHS)[number];

/**
 * ADR-0142: which receipts a free block prints on — every one, a credit slip only or every other,
 * a bonus card member's, a company's (B2B) or a person's (B2C).
 */
export const RECEIPT_WHENS = ['ALWAYS', 'CREDIT', 'NOT_CREDIT', 'MEMBER', 'B2B', 'B2C'] as const;
export type ReceiptWhen = (typeof RECEIPT_WHENS)[number];

/** ADR-0142: the receipt's values a text may print, written `{{number}}`. */
export const RECEIPT_TEXT_VARIABLES = [
  'number',
  'date',
  'time',
  'till',
  'cashier',
  'total',
  'customer',
  'member',
  'points',
  'store',
] as const;
export type ReceiptTextVariable = (typeof RECEIPT_TEXT_VARIABLES)[number];

export const RECEIPT_BLOCK_TYPES = [
  'HEADING',
  'DOC_INFO',
  'LINES',
  'TOTALS',
  'PAYMENTS',
  'LOYALTY',
  'EBARIMT',
  'SIGNATURE',
  'FOOTER',
  'BARCODE',
  'TEXT',
  'LOGO',
  'QR',
  'DIVIDER',
  'SPACE',
] as const;
export type ReceiptBlockType = (typeof RECEIPT_BLOCK_TYPES)[number];

/** Always there, exactly once: moved and set, never taken out or hidden. */
export const RECEIPT_REQUIRED_BLOCKS: readonly ReceiptBlockType[] = [
  'HEADING',
  'DOC_INFO',
  'LINES',
  'TOTALS',
  'PAYMENTS',
  'EBARIMT',
  'SIGNATURE',
];
/** At most once. */
export const RECEIPT_SINGLE_BLOCKS: readonly ReceiptBlockType[] = [
  ...RECEIPT_REQUIRED_BLOCKS,
  'LOYALTY',
  'FOOTER',
  'BARCODE',
];
/** The blocks that may print on some receipts only, within dates (ADR-0142). */
export const RECEIPT_CONDITIONAL_BLOCKS: readonly ReceiptBlockType[] = [
  'TEXT',
  'LOGO',
  'QR',
  'DIVIDER',
  'SPACE',
];

export const RECEIPT_TEMPLATE_LIMITS = {
  maxBlocks: 40,
  maxText: 500,
  maxTitle: 200,
  maxName: 80,
  maxTemplates: 40,
  maxQrData: 300,
  maxCaption: 80,
  /** A logo as a PNG data URL: about 45 KB, a black-and-white picture up to 576 × 300 dots. */
  maxImageChars: 60_000,
} as const;

/** ADR-0142: printed always (the default), on some receipts only, within dates, or kept hidden. */
export interface ReceiptBlockShow {
  when?: ReceiptWhen;
  /** The first and the last business day it prints (`YYYY-MM-DD`); null: open. */
  from?: string | null;
  to?: string | null;
  /** Kept in the template but not printed. */
  hidden?: boolean;
}

/**
 * The store's heading: a title over the seller's name (empty: the store's own heading from the
 * settings), the seller's TIN on a real e-Barimt receipt, then the banners — a copy, a credit slip,
 * a test receipt, a return. Only the title, the company line and the alignment are the admin's.
 */
export interface ReceiptHeadingBlock {
  type: 'HEADING';
  title: string | null;
  showCompany: boolean;
  align: ReceiptAlign;
  size: ReceiptSize;
}
/** The number and the time always; the POS, the cashier as set; the buyer, the credit customer and the ДДТД whenever there. */
export interface ReceiptDocInfoBlock {
  type: 'DOC_INFO';
  showTill: boolean;
  showCashier: boolean;
}
/** Each line: its name, then quantity × price and the amount (or the name and the amount in one row when compact). */
export interface ReceiptLinesBlock {
  type: 'LINES';
  compact: boolean;
}
/** The discounts and coupons, the total and the VAT in it (no VAT on a credit slip). */
export interface ReceiptTotalsBlock {
  type: 'TOTALS';
  large: boolean;
}
/** The tenders and the change, or what a return paid back. */
export interface ReceiptPaymentsBlock {
  type: 'PAYMENTS';
  showTendered: boolean;
}
export interface ReceiptLoyaltyBlock extends Pick<ReceiptBlockShow, 'hidden'> {
  type: 'LOYALTY';
}
/** The e-Barimt part: its state, the replaced receipt, the lottery and the QR code. */
export interface ReceiptEbarimtBlock {
  type: 'EBARIMT';
}
/** A credit slip's line for the customer's signature (ADR-0109). */
export interface ReceiptSignatureBlock {
  type: 'SIGNATURE';
}
/** The store's closing line from the settings (or the thanks). */
export interface ReceiptFooterBlock extends Pick<ReceiptBlockShow, 'hidden'> {
  type: 'FOOTER';
}
/** ADR-0142: the receipt's number as a Code 128 barcode: scanned at the till it opens the return. */
export interface ReceiptBarcodeBlock extends Pick<ReceiptBlockShow, 'hidden'> {
  type: 'BARCODE';
  showNumber: boolean;
}
export interface ReceiptTextBlock extends ReceiptBlockShow {
  type: 'TEXT';
  /** `{{number}}` and the other RECEIPT_TEXT_VARIABLES print the receipt's values. */
  text: string;
  align: ReceiptAlign;
  size: ReceiptSize;
  bold: boolean;
  /** White on black. */
  inverse?: boolean;
}
/** ADR-0142: a black-and-white picture (the store's logo), a PNG data URL made in the editor. */
export interface ReceiptLogoBlock extends ReceiptBlockShow {
  type: 'LOGO';
  image: string;
  width: ReceiptLogoWidth;
  align: ReceiptAlign;
}
/** ADR-0142: the store's own QR code (a web page, a feedback form) with a line under it. */
export interface ReceiptQrBlock extends ReceiptBlockShow {
  type: 'QR';
  data: string;
  caption: string | null;
  size: ReceiptSize;
}
export interface ReceiptDividerBlock extends ReceiptBlockShow {
  type: 'DIVIDER';
  rule: ReceiptRule;
}
export interface ReceiptSpaceBlock extends ReceiptBlockShow {
  type: 'SPACE';
  size: ReceiptSize;
}

export type ReceiptBlock =
  | ReceiptHeadingBlock
  | ReceiptDocInfoBlock
  | ReceiptLinesBlock
  | ReceiptTotalsBlock
  | ReceiptPaymentsBlock
  | ReceiptLoyaltyBlock
  | ReceiptEbarimtBlock
  | ReceiptSignatureBlock
  | ReceiptFooterBlock
  | ReceiptBarcodeBlock
  | ReceiptTextBlock
  | ReceiptLogoBlock
  | ReceiptQrBlock
  | ReceiptDividerBlock
  | ReceiptSpaceBlock;

export interface ReceiptLayout {
  paper: ReceiptPaper;
  /** The receipt's base text size. */
  size: ReceiptSize;
  blocks: ReceiptBlock[];
}

/** A published template as the snapshot carries it to the edge. */
export interface SnapshotReceiptTemplate {
  id: number;
  kind: ReceiptTemplateKind;
  isDefault: boolean;
  version: number;
  layout: ReceiptLayout;
}

/** A 1 × 1 white PNG: a new logo block's picture until one is chosen. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWB6l1wAAAABJRU5ErkJggg==';

/** A new block of a type, with its first options. */
export function newReceiptBlock(type: ReceiptBlockType): ReceiptBlock {
  switch (type) {
    case 'HEADING':
      return { type, title: null, showCompany: true, align: 'CENTER', size: 'MD' };
    case 'DOC_INFO':
      return { type, showTill: true, showCashier: true };
    case 'LINES':
      return { type, compact: false };
    case 'TOTALS':
      return { type, large: true };
    case 'PAYMENTS':
      return { type, showTendered: true };
    case 'BARCODE':
      return { type, showNumber: true };
    case 'TEXT':
      return { type, text: '', align: 'CENTER', size: 'MD', bold: false };
    case 'LOGO':
      return { type, image: BLANK_PNG, width: 60, align: 'CENTER' };
    case 'QR':
      return { type, data: '', caption: null, size: 'MD' };
    case 'DIVIDER':
      return { type, rule: 'DASHED' };
    case 'SPACE':
      return { type, size: 'MD' };
    default:
      return { type };
  }
}

/** The receipt as it printed before templates (ADR-0065): what a template starts from. */
export function defaultReceiptLayout(): ReceiptLayout {
  const rule = (): ReceiptDividerBlock => ({ type: 'DIVIDER', rule: 'DASHED' });
  return {
    paper: 'MM80',
    size: 'MD',
    blocks: [
      newReceiptBlock('HEADING'),
      rule(),
      newReceiptBlock('DOC_INFO'),
      rule(),
      newReceiptBlock('LINES'),
      rule(),
      newReceiptBlock('TOTALS'),
      rule(),
      newReceiptBlock('PAYMENTS'),
      newReceiptBlock('LOYALTY'),
      newReceiptBlock('EBARIMT'),
      newReceiptBlock('SIGNATURE'),
      newReceiptBlock('FOOTER'),
    ],
  };
}

export type ReceiptLayoutCheck =
  { ok: true; layout: ReceiptLayout } | { ok: false; path: string; rule: string; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const oneOf = <T extends string | number>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

const DAY = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

class LayoutError extends Error {
  readonly path: string;
  readonly rule: string;
  readonly detail: string;
  constructor(path: string, rule: string, detail: string) {
    super(detail);
    this.path = path;
    this.rule = rule;
    this.detail = detail;
  }
}

function field<T extends string | number>(
  raw: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string,
): T {
  const value = raw[key];
  if (!oneOf(values, value)) throw new LayoutError(`${path}.${key}`, 'enum', values.join(', '));
  return value;
}

function flag(raw: Record<string, unknown>, key: string, path: string): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean')
    throw new LayoutError(`${path}.${key}`, 'boolean', 'true or false');
  return value;
}

/** A text of 1…max characters (trimmed, line breaks kept), or null when `optional` and empty. */
function text(
  raw: Record<string, unknown>,
  key: string,
  max: number,
  path: string,
  optional: boolean,
): string | null {
  const value = raw[key] ?? null;
  if (value === null && optional) return null;
  if (typeof value !== 'string') throw new LayoutError(`${path}.${key}`, 'string', 'text');
  const trimmed = value.replace(/\r\n?/g, '\n').trim();
  if (trimmed === '' && optional) return null;
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new LayoutError(`${path}.${key}`, 'length', `1 to ${max}`);
  }
  return trimmed;
}

/** The hidden flag, kept only when set. */
function hiddenOf(raw: Record<string, unknown>, path: string): Pick<ReceiptBlockShow, 'hidden'> {
  if (raw.hidden === undefined || raw.hidden === false) return {};
  return { hidden: flag(raw, 'hidden', path) };
}

/** When a free block prints; only what differs from «always, every day, shown» is kept. */
function showOf(raw: Record<string, unknown>, path: string): ReceiptBlockShow {
  const show: ReceiptBlockShow = { ...hiddenOf(raw, path) };
  if (raw.when !== undefined && raw.when !== 'ALWAYS') {
    show.when = field(raw, 'when', RECEIPT_WHENS, path);
  }
  for (const key of ['from', 'to'] as const) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !DAY.test(value)) {
      throw new LayoutError(`${path}.${key}`, 'date', 'YYYY-MM-DD');
    }
    show[key] = value;
  }
  if (show.from && show.to && show.from > show.to) {
    throw new LayoutError(`${path}.to`, 'range', 'on or after from');
  }
  return show;
}

function block(raw: unknown, path: string): ReceiptBlock {
  if (!isRecord(raw)) throw new LayoutError(path, 'object', 'a block');
  const type = field(raw, 'type', RECEIPT_BLOCK_TYPES, path);
  switch (type) {
    case 'HEADING':
      return {
        type,
        title: text(raw, 'title', RECEIPT_TEMPLATE_LIMITS.maxTitle, path, true),
        showCompany: flag(raw, 'showCompany', path),
        align: field(raw, 'align', RECEIPT_ALIGNS, path),
        size: field(raw, 'size', RECEIPT_SIZES, path),
      };
    case 'DOC_INFO':
      return {
        type,
        showTill: flag(raw, 'showTill', path),
        showCashier: flag(raw, 'showCashier', path),
      };
    case 'LINES':
      return { type, compact: flag(raw, 'compact', path) };
    case 'TOTALS':
      return { type, large: flag(raw, 'large', path) };
    case 'PAYMENTS':
      return { type, showTendered: flag(raw, 'showTendered', path) };
    case 'LOYALTY':
    case 'FOOTER':
      return { type, ...hiddenOf(raw, path) };
    case 'BARCODE':
      return { type, showNumber: flag(raw, 'showNumber', path), ...hiddenOf(raw, path) };
    case 'TEXT':
      return {
        type,
        text: text(raw, 'text', RECEIPT_TEMPLATE_LIMITS.maxText, path, false) ?? '',
        align: field(raw, 'align', RECEIPT_ALIGNS, path),
        size: field(raw, 'size', RECEIPT_SIZES, path),
        bold: flag(raw, 'bold', path),
        ...(raw.inverse === true ? { inverse: true } : {}),
        ...showOf(raw, path),
      };
    case 'LOGO': {
      const image = raw.image;
      if (
        typeof image !== 'string' ||
        image.length > RECEIPT_TEMPLATE_LIMITS.maxImageChars ||
        !PNG_DATA_URL.test(image)
      ) {
        throw new LayoutError(
          `${path}.image`,
          'image',
          `a PNG data URL of at most ${RECEIPT_TEMPLATE_LIMITS.maxImageChars} characters`,
        );
      }
      return {
        type,
        image,
        width: field(raw, 'width', RECEIPT_LOGO_WIDTHS, path),
        align: field(raw, 'align', RECEIPT_ALIGNS, path),
        ...showOf(raw, path),
      };
    }
    case 'QR':
      return {
        type,
        data: text(raw, 'data', RECEIPT_TEMPLATE_LIMITS.maxQrData, path, false) ?? '',
        caption: text(raw, 'caption', RECEIPT_TEMPLATE_LIMITS.maxCaption, path, true),
        size: field(raw, 'size', RECEIPT_SIZES, path),
        ...showOf(raw, path),
      };
    case 'DIVIDER':
      return { type, rule: field(raw, 'rule', RECEIPT_RULES, path), ...showOf(raw, path) };
    case 'SPACE':
      return { type, size: field(raw, 'size', RECEIPT_SIZES, path), ...showOf(raw, path) };
    default:
      return { type };
  }
}

/**
 * A layout as the admin sent it, checked and cleaned: the paper and the size known, at most 40
 * blocks of known types with their options, the required blocks exactly once, the single ones at
 * most once, texts trimmed and within their limits, a logo a PNG of bounded size, dates real.
 */
export function checkReceiptLayout(raw: unknown): ReceiptLayoutCheck {
  try {
    if (!isRecord(raw)) throw new LayoutError('layout', 'object', 'a layout');
    const paper = field(raw, 'paper', RECEIPT_PAPERS, 'layout');
    const size = field(raw, 'size', RECEIPT_SIZES, 'layout');
    if (!Array.isArray(raw.blocks)) throw new LayoutError('layout.blocks', 'array', 'a list');
    if (raw.blocks.length > RECEIPT_TEMPLATE_LIMITS.maxBlocks) {
      throw new LayoutError(
        'layout.blocks',
        'count',
        `at most ${RECEIPT_TEMPLATE_LIMITS.maxBlocks} blocks`,
      );
    }
    const blocks = raw.blocks.map((entry, index) => block(entry, `layout.blocks[${index}]`));
    for (const type of RECEIPT_SINGLE_BLOCKS) {
      const count = blocks.filter((entry) => entry.type === type).length;
      if (count > 1) throw new LayoutError('layout.blocks', 'single', `${type} at most once`);
      if (count === 0 && RECEIPT_REQUIRED_BLOCKS.includes(type)) {
        throw new LayoutError('layout.blocks', 'required', `${type} is required`);
      }
    }
    return { ok: true, layout: { paper, size, blocks } };
  } catch (error) {
    if (error instanceof LayoutError) {
      return { ok: false, path: error.path, rule: error.rule, detail: error.detail };
    }
    throw error;
  }
}

/** What decides whether a free block prints on one receipt (ADR-0142). */
export interface ReceiptFacts {
  credit: boolean;
  member: boolean;
  b2b: boolean;
  /** The receipt's business day, `YYYY-MM-DD`. */
  day: string;
}

/** Whether a block prints on a receipt with these facts: not hidden, its condition met, within its dates. */
export function receiptBlockShown(block: ReceiptBlock, facts: ReceiptFacts): boolean {
  const show = block as ReceiptBlockShow;
  if (show.hidden === true) return false;
  if (show.from && facts.day < show.from) return false;
  if (show.to && facts.day > show.to) return false;
  switch (show.when ?? 'ALWAYS') {
    case 'CREDIT':
      return facts.credit;
    case 'NOT_CREDIT':
      return !facts.credit;
    case 'MEMBER':
      return facts.member;
    case 'B2B':
      return facts.b2b;
    case 'B2C':
      return !facts.b2b;
    default:
      return true;
  }
}

/** A text with `{{number}}` and the other variables filled in; an unknown or empty value prints nothing. */
export function fillReceiptText(
  text: string,
  values: Partial<Record<ReceiptTextVariable, string | null>>,
): string {
  return text.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (whole, name: string) =>
    (RECEIPT_TEXT_VARIABLES as readonly string[]).includes(name)
      ? (values[name as ReceiptTextVariable] ?? '')
      : whole,
  );
}

/** The layout a POS prints a receipt of this kind with: its own choice, else the default, else none (the built-in one). */
export function receiptLayoutFor(
  templates: readonly SnapshotReceiptTemplate[] | undefined,
  kind: ReceiptTemplateKind,
  chosenId: number | null | undefined,
): ReceiptLayout | null {
  const list = templates ?? [];
  const chosen = chosenId == null ? undefined : list.find((entry) => entry.id === chosenId);
  const template =
    chosen?.kind === kind ? chosen : list.find((entry) => entry.kind === kind && entry.isDefault);
  return template?.layout ?? null;
}

/**
 * ADR-0142: a sale receipt's barcode — digits only, so a scanner reads it the same in any keyboard
 * layout: `993`, the till's id (4 digits), the day (`YYMMDD`) and the number of the day (4 digits)
 * from `К1-261104-0042`, and a Luhn check digit; 18 digits, Code 128 set C. Null when the number
 * is not a sale's or the till's id does not fit.
 */
export function posReceiptBarcode(tillId: number, number: string): string | null {
  const parts = /^.+-([0-9]{6})-([0-9]{4})$/.exec(number);
  if (!parts || !Number.isInteger(tillId) || tillId < 1 || tillId > 9999) return null;
  const body = `993${String(tillId).padStart(4, '0')}${parts[1]}${parts[2]}`;
  return body + luhnDigit(body);
}

/** A scanned receipt barcode's till id, day (`YYMMDD`) and number of the day; null otherwise. */
export function parsePosReceiptBarcode(
  text: string,
): { tillId: number; day: string; seq: string } | null {
  const code = text.replace(/[\s-]/g, '');
  if (!/^993[0-9]{15}$/.test(code)) return null;
  if (luhnDigit(code.slice(0, -1)) !== code.slice(-1)) return null;
  return {
    tillId: Number.parseInt(code.slice(3, 7), 10),
    day: code.slice(7, 13),
    seq: code.slice(13, 17),
  };
}

/**
 * ADR-0143: the checks the sales documents' templates share with the receipt's — a field of a set,
 * a flag, a bounded text, the hidden flag, and a free block (text, logo, QR, rule, space) checked
 * as a receipt's. They throw `TemplateLayoutError`; `catchTemplateLayout` turns it into a result.
 */
export const templateChecks = {
  isRecord,
  field,
  flag,
  text,
  hidden: hiddenOf,
  show: showOf,
  block,
};
export { LayoutError as TemplateLayoutError };

export function catchTemplateLayout<T>(
  run: () => T,
): { ok: true; value: T } | { ok: false; path: string; rule: string; detail: string } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof LayoutError) {
      return { ok: false, path: error.path, rule: error.rule, detail: error.detail };
    }
    throw error;
  }
}
