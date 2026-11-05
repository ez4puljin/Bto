import {
  catchTemplateLayout,
  RECEIPT_ALIGNS,
  RECEIPT_SIZES,
  type ReceiptAlign,
  type ReceiptBlockShow,
  type ReceiptDividerBlock,
  type ReceiptLogoBlock,
  type ReceiptQrBlock,
  type ReceiptSize,
  type ReceiptSpaceBlock,
  type ReceiptTextBlock,
  TemplateLayoutError,
  templateChecks,
} from '../pos/receipt-template';

/**
 * The wholesale orders' printed documents laid out from blocks (ADR-0143, owner 2026-11-04: «Падаан
 * + Бэлтгэх хуудас», «Посынх шиг блок editor», «Нэг үндсэн, дамжлага бүрт сонгож болно»): one
 * template per document kind is the default, a pipeline may choose another. The paper (A4 or the
 * 80 mm roll) is still chosen when printing; a template lays the document out for both. The heading,
 * the order's facts and the lines are always there (and a delivery note's totals); the columns of
 * the lines are chosen and ordered; signatures, texts, a logo, a QR code, rules and spaces are free.
 */

export const DOCUMENT_TEMPLATE_KINDS = ['PICK_LIST', 'DELIVERY_NOTE'] as const;
export type DocumentTemplateKind = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

/** The lines' columns each document can print, in their default order. */
export const DOCUMENT_COLUMNS = {
  PICK_LIST: ['NO', 'SKU', 'PRODUCT', 'QTY', 'BASE_QTY', 'BIN', 'PICKED'],
  DELIVERY_NOTE: ['NO', 'SKU', 'PRODUCT', 'QTY', 'UNIT_PRICE', 'TOTAL', 'DELIVERED'],
} as const;
export type DocumentColumn =
  (typeof DOCUMENT_COLUMNS.PICK_LIST)[number] | (typeof DOCUMENT_COLUMNS.DELIVERY_NOTE)[number];
/** Never switched off: what the product is and how many. */
export const DOCUMENT_REQUIRED_COLUMNS: readonly DocumentColumn[] = ['PRODUCT', 'QTY'];
/** Switched off in a new template. */
const COLUMNS_OFF: readonly DocumentColumn[] = ['NO'];

/** The order's facts the heading may list. */
export const DOCUMENT_INFO_FIELDS = [
  'customer',
  'fulfilment',
  'address',
  'contact',
  'payment',
  'createdBy',
  'note',
] as const;
export type DocumentInfoField = (typeof DOCUMENT_INFO_FIELDS)[number];

export const DOCUMENT_BLOCK_TYPES = [
  'HEADING',
  'ORDER_INFO',
  'LINES',
  'TOTALS',
  'SIGNATURES',
  'TEXT',
  'LOGO',
  'QR',
  'DIVIDER',
  'SPACE',
] as const;
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

export const DOCUMENT_TEMPLATE_LIMITS = {
  maxBlocks: 40,
  maxTitle: 120,
  maxSignature: 60,
  maxSignatures: 4,
  maxName: 80,
  maxTemplates: 40,
} as const;

/** The company, the document's name and number, the print time; on the roll everything centred. */
export interface DocumentHeadingBlock {
  type: 'HEADING';
  /** Instead of «Падаан» / «Бэлтгэх хуудас»; null keeps it. */
  title: string | null;
  showCompany: boolean;
  /** The company's ТТД and register number from «Компани». */
  showTin: boolean;
  showPrintedAt: boolean;
  align: ReceiptAlign;
}
export interface DocumentOrderInfoBlock {
  type: 'ORDER_INFO';
  fields: Record<DocumentInfoField, boolean>;
}
export interface DocumentLinesBlock {
  type: 'LINES';
  /** In print order; `on: false` keeps a column's place in the editor without printing it. */
  columns: { key: DocumentColumn; on: boolean }[];
  /** A pick list's sections per warehouse; a delivery note ignores it. */
  byWarehouse: boolean;
}
/** A delivery note's subtotal, discount and total. */
export interface DocumentTotalsBlock {
  type: 'TOTALS';
  showSubtotal: boolean;
  showDiscount: boolean;
  large: boolean;
}
/** Lines to sign on, side by side on A4. */
export interface DocumentSignaturesBlock extends Pick<ReceiptBlockShow, 'hidden'> {
  type: 'SIGNATURES';
  labels: string[];
}
type Free<T> = Omit<T, 'when'>;
export type DocumentBlock =
  | DocumentHeadingBlock
  | DocumentOrderInfoBlock
  | DocumentLinesBlock
  | DocumentTotalsBlock
  | DocumentSignaturesBlock
  | Free<ReceiptTextBlock>
  | Free<ReceiptLogoBlock>
  | Free<ReceiptQrBlock>
  | Free<ReceiptDividerBlock>
  | Free<ReceiptSpaceBlock>;

export interface DocumentLayout {
  /** The document's base text size. */
  size: ReceiptSize;
  blocks: DocumentBlock[];
}

/** A published template as the print page takes it. */
export interface PublishedDocumentTemplate {
  id: number;
  kind: DocumentTemplateKind;
  isDefault: boolean;
  layout: DocumentLayout;
}

/** Always there, exactly once; a delivery note also has its totals. */
export function documentRequiredBlocks(kind: DocumentTemplateKind): readonly DocumentBlockType[] {
  return kind === 'DELIVERY_NOTE'
    ? ['HEADING', 'ORDER_INFO', 'LINES', 'TOTALS']
    : ['HEADING', 'ORDER_INFO', 'LINES'];
}
export const DOCUMENT_SINGLE_BLOCKS: readonly DocumentBlockType[] = [
  'HEADING',
  'ORDER_INFO',
  'LINES',
  'TOTALS',
  'SIGNATURES',
];
/** The blocks that may print within dates or be hidden. */
export const DOCUMENT_FREE_BLOCKS: readonly DocumentBlockType[] = [
  'TEXT',
  'LOGO',
  'QR',
  'DIVIDER',
  'SPACE',
];

export function newDocumentBlock(
  type: DocumentBlockType,
  kind: DocumentTemplateKind,
): DocumentBlock {
  switch (type) {
    case 'HEADING':
      return {
        type,
        title: null,
        showCompany: true,
        showTin: false,
        showPrintedAt: true,
        align: 'LEFT',
      };
    case 'ORDER_INFO':
      return {
        type,
        fields: Object.fromEntries(DOCUMENT_INFO_FIELDS.map((key) => [key, true])) as Record<
          DocumentInfoField,
          boolean
        >,
      };
    case 'LINES':
      return {
        type,
        columns: DOCUMENT_COLUMNS[kind].map((key) => ({ key, on: !COLUMNS_OFF.includes(key) })),
        byWarehouse: true,
      };
    case 'TOTALS':
      return { type, showSubtotal: true, showDiscount: true, large: false };
    case 'SIGNATURES':
      return { type, labels: ['Хүлээлгэн өгсөн', 'Хүлээн авсан'] };
    case 'TEXT':
      return { type, text: '', align: 'LEFT', size: 'MD', bold: false };
    case 'LOGO':
      return {
        type,
        image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWB6l1wAAAABJRU5ErkJggg==',
        width: 40,
        align: 'LEFT',
      };
    case 'QR':
      return { type, data: '', caption: null, size: 'SM' };
    case 'DIVIDER':
      return { type, rule: 'SOLID' };
    case 'SPACE':
      return { type, size: 'MD' };
  }
}

/** The document as it printed before templates (ADR-0058): what a template starts from. */
export function defaultDocumentLayout(kind: DocumentTemplateKind): DocumentLayout {
  const block = (type: DocumentBlockType) => newDocumentBlock(type, kind);
  if (kind === 'PICK_LIST') {
    return {
      size: 'MD',
      blocks: [
        block('HEADING'),
        block('ORDER_INFO'),
        block('LINES'),
        {
          type: 'TEXT',
          text: 'Бэлтгэсэн тоог самбар дээрх картаас батална.',
          align: 'LEFT',
          size: 'SM',
          bold: false,
        },
      ],
    };
  }
  return {
    size: 'MD',
    blocks: [
      block('HEADING'),
      block('ORDER_INFO'),
      block('LINES'),
      block('TOTALS'),
      block('SIGNATURES'),
    ],
  };
}

export type DocumentLayoutCheck =
  { ok: true; layout: DocumentLayout } | { ok: false; path: string; rule: string; detail: string };

const { isRecord, field, flag, text } = templateChecks;

function documentBlock(raw: unknown, path: string, kind: DocumentTemplateKind): DocumentBlock {
  if (!isRecord(raw)) throw new TemplateLayoutError(path, 'object', 'a block');
  const type = field(raw, 'type', DOCUMENT_BLOCK_TYPES, path);
  switch (type) {
    case 'HEADING':
      return {
        type,
        title: text(raw, 'title', DOCUMENT_TEMPLATE_LIMITS.maxTitle, path, true),
        showCompany: flag(raw, 'showCompany', path),
        showTin: flag(raw, 'showTin', path),
        showPrintedAt: flag(raw, 'showPrintedAt', path),
        align: field(raw, 'align', RECEIPT_ALIGNS, path),
      };
    case 'ORDER_INFO': {
      const fields = raw.fields;
      if (!isRecord(fields)) throw new TemplateLayoutError(`${path}.fields`, 'object', 'flags');
      return {
        type,
        fields: Object.fromEntries(
          DOCUMENT_INFO_FIELDS.map((key) => [key, flag(fields, key, `${path}.fields`)]),
        ) as Record<DocumentInfoField, boolean>,
      };
    }
    case 'LINES': {
      const allowed: readonly DocumentColumn[] = DOCUMENT_COLUMNS[kind];
      if (!Array.isArray(raw.columns)) {
        throw new TemplateLayoutError(`${path}.columns`, 'array', 'a list');
      }
      const columns = raw.columns.map((entry, index) => {
        const at = `${path}.columns[${index}]`;
        if (!isRecord(entry)) throw new TemplateLayoutError(at, 'object', 'a column');
        return { key: field(entry, 'key', allowed, at), on: flag(entry, 'on', at) };
      });
      const keys = columns.map((column) => column.key);
      if (new Set(keys).size !== keys.length || keys.length !== allowed.length) {
        throw new TemplateLayoutError(
          `${path}.columns`,
          'columns',
          `each of ${allowed.join(', ')} once`,
        );
      }
      for (const key of DOCUMENT_REQUIRED_COLUMNS) {
        if (!columns.some((column) => column.key === key && column.on)) {
          throw new TemplateLayoutError(`${path}.columns`, 'required', `${key} is printed`);
        }
      }
      return { type, columns, byWarehouse: flag(raw, 'byWarehouse', path) };
    }
    case 'TOTALS':
      return {
        type,
        showSubtotal: flag(raw, 'showSubtotal', path),
        showDiscount: flag(raw, 'showDiscount', path),
        large: flag(raw, 'large', path),
      };
    case 'SIGNATURES': {
      if (!Array.isArray(raw.labels)) {
        throw new TemplateLayoutError(`${path}.labels`, 'array', 'a list');
      }
      if (raw.labels.length < 1 || raw.labels.length > DOCUMENT_TEMPLATE_LIMITS.maxSignatures) {
        throw new TemplateLayoutError(
          `${path}.labels`,
          'count',
          `1 to ${DOCUMENT_TEMPLATE_LIMITS.maxSignatures}`,
        );
      }
      const labels = raw.labels.map(
        (_, index) =>
          text(
            raw.labels as Record<string, unknown>,
            String(index),
            DOCUMENT_TEMPLATE_LIMITS.maxSignature,
            `${path}.labels`,
            false,
          ) ?? '',
      );
      return { type, labels, ...templateChecks.hidden(raw, path) };
    }
    default: {
      // A free block is checked as a receipt's; a document has no receipt conditions.
      const checked = templateChecks.block(raw, path) as Free<ReceiptTextBlock> & {
        when?: unknown;
      };
      delete checked.when;
      return checked;
    }
  }
}

/**
 * A document layout as the admin sent it, checked and cleaned: the size known, at most 40 blocks,
 * the kind's required blocks exactly once, the single ones at most once, the lines' columns each of
 * the kind's once with the product and the quantity printed.
 */
export function checkDocumentLayout(raw: unknown, kind: DocumentTemplateKind): DocumentLayoutCheck {
  const result = catchTemplateLayout((): DocumentLayout => {
    if (!isRecord(raw)) throw new TemplateLayoutError('layout', 'object', 'a layout');
    const size = field(raw, 'size', RECEIPT_SIZES, 'layout');
    if (!Array.isArray(raw.blocks))
      throw new TemplateLayoutError('layout.blocks', 'array', 'a list');
    if (raw.blocks.length > DOCUMENT_TEMPLATE_LIMITS.maxBlocks) {
      throw new TemplateLayoutError(
        'layout.blocks',
        'count',
        `at most ${DOCUMENT_TEMPLATE_LIMITS.maxBlocks} blocks`,
      );
    }
    const blocks = raw.blocks.map((entry, index) =>
      documentBlock(entry, `layout.blocks[${index}]`, kind),
    );
    const required = documentRequiredBlocks(kind);
    for (const type of DOCUMENT_SINGLE_BLOCKS) {
      const count = blocks.filter((entry) => entry.type === type).length;
      if (count > 1)
        throw new TemplateLayoutError('layout.blocks', 'single', `${type} at most once`);
      if (count === 0 && required.includes(type)) {
        throw new TemplateLayoutError('layout.blocks', 'required', `${type} is required`);
      }
    }
    if (kind === 'PICK_LIST' && blocks.some((entry) => entry.type === 'TOTALS')) {
      throw new TemplateLayoutError('layout.blocks', 'kind', 'a pick list has no totals');
    }
    return { size, blocks };
  });
  return result.ok ? { ok: true, layout: result.value } : result;
}

/** Whether a block prints on a document of this business day: not hidden, within its dates. */
export function documentBlockShown(block: DocumentBlock, day: string): boolean {
  const show = block as ReceiptBlockShow;
  if (show.hidden === true) return false;
  if (show.from && day < show.from) return false;
  if (show.to && day > show.to) return false;
  return true;
}

/** The layout a pipeline prints a document of this kind with: its own choice, else the default, else none. */
export function documentLayoutFor(
  templates: readonly PublishedDocumentTemplate[] | undefined,
  kind: DocumentTemplateKind,
  chosenId: number | null | undefined,
): DocumentLayout | null {
  const list = templates ?? [];
  const chosen = chosenId == null ? undefined : list.find((entry) => entry.id === chosenId);
  const template =
    chosen?.kind === kind ? chosen : list.find((entry) => entry.kind === kind && entry.isDefault);
  return template?.layout ?? null;
}
