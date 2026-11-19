/**
 * Erkhet's general journal as its list page shows it (ADR-0219). Erkhet has no API: a page of the
 * list is an HTML document whose rows stand in an inline script, `var items = [ … ];`, and again in
 * the table below it. Pure functions: nothing here reaches Erkhet.
 */

/** One line of a transaction on the account the list was filtered to. */
export interface ErkhetJournalLine {
  /**
   * Erkhet's transaction: the document the line belongs to. 0 for a line that stands before the
   * page's first transaction header: the page began inside a transaction, and the line belongs to
   * the last transaction of the page before it (`joinJournalPages`).
   */
  trId: number;
  /** «Ажил гүйлгээний дугаар», the number a person sees. */
  ptrId: number | null;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Erkhet's account code, as the line shows it. */
  accountCode: string;
  /** Scale 2, never negative: a negative amount is read as the other side. */
  debit: string;
  credit: string;
  /** «Гүйлгээний утга». */
  description: string;
  /** «Баримтын дугаар». */
  billNumber: string;
  /** «код - нэр», as Erkhet writes it; empty for a line without a party. */
  customer: string;
}

/** A page Bto could not read; carries no part of the page. */
export class ErkhetPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErkhetPageError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The lines of one page, in the page's order; an empty array for a page past the end. */
export function readJournalPage(html: string): ErkhetJournalLine[] {
  const items = scriptItems(html);
  if (items !== null) return linesOfItems(items);
  const table = tableLines(html);
  if (table !== null) return table;
  throw new ErkhetPageError('the page holds neither `var items` nor the journal table');
}

/** `1,234.50` → `1234.50`; empty → `0.00`. Throws on anything that is not an amount. */
export function readAmount(text: unknown): string {
  const raw = typeof text === 'number' ? String(text) : typeof text === 'string' ? text : '';
  const value = raw.replace(/[\s,]/g, '');
  if (value === '') return '0.00';
  const match = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new ErkhetPageError('an amount of the journal is not a number');
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const amount = `${whole}.${(match[3] ?? '').padEnd(2, '0')}`;
  return match[1] === '-' && amount !== '0.00' ? `-${amount}` : amount;
}

/** A line's two amounts with a negative one moved to the other side. */
function sides(debitText: unknown, creditText: unknown): { debit: string; credit: string } {
  let debit = readAmount(debitText);
  let credit = readAmount(creditText);
  if (debit.startsWith('-') && credit === '0.00') {
    credit = debit.slice(1);
    debit = '0.00';
  } else if (credit.startsWith('-') && debit === '0.00') {
    debit = credit.slice(1);
    credit = '0.00';
  }
  if (debit.startsWith('-') || credit.startsWith('-')) {
    throw new ErkhetPageError('a line of the journal has a negative amount beside another');
  }
  return { debit, credit };
}

// ---- the script form ---------------------------------------------------------------------------

/** The array of `var items = [ … ];`, or null when the page has no such script. */
function scriptItems(html: string): unknown[] | null {
  const start = /\bvar\s+items\s*=\s*\[/.exec(html);
  if (!start) return null;
  const open = start.index + start[0].length - 1;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let at = open; at < html.length; at += 1) {
    const char = html[at];
    if (inString) {
      if (char === '\\') at += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = at;
        break;
      }
    }
  }
  if (end < 0) throw new ErkhetPageError('`var items` does not end');
  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(open, end + 1));
  } catch {
    throw new ErkhetPageError('`var items` is not JSON');
  }
  if (!Array.isArray(parsed)) throw new ErkhetPageError('`var items` is not a list');
  return parsed as unknown[];
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

function id(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.parseInt(text(value), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function linesOfItems(items: readonly unknown[]): ErkhetJournalLine[] {
  const lines: ErkhetJournalLine[] = [];
  let header: { trId: number; ptrId: number | null } | null = null;
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      throw new ErkhetPageError('a row of `var items` is not an object');
    }
    const row = item as Record<string, unknown>;
    if (row.is_ptr === true) {
      const trId = id(row.tr_id);
      if (trId === null) throw new ErkhetPageError('a transaction header has no tr_id');
      header = { trId, ptrId: id(row.ptr__id) };
      continue;
    }
    const date = text(row.date);
    if (!ISO_DATE.test(date)) throw new ErkhetPageError('a line of the journal has no date');
    lines.push({
      trId: header?.trId ?? 0,
      ptrId: header?.ptrId ?? id(row.ptr__id),
      date,
      accountCode: text(row.full_code),
      ...sides(row.debit_text, row.credit_text),
      description: text(row.description),
      billNumber: text(row.bill_number),
      customer: text(row.customer),
    });
  }
  return lines;
}

// ---- the table form ----------------------------------------------------------------------------

/** The table's columns by their heading; the names Erkhet's page shows. */
const HEADINGS: Readonly<Record<string, readonly string[]>> = {
  date: ['огноо'],
  accountCode: ['дансны код', 'данс код', 'код'],
  debit: ['дебит', 'дт'],
  credit: ['кредит', 'кт'],
  description: ['гүйлгээний утга', 'утга'],
  billNumber: ['баримтын дугаар', 'баримт'],
  customer: ['харилцагч'],
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function cellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1]?.toLowerCase() === 'x'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The lines of the HTML table, or null when the page has no transaction rows and no table head. */
function tableLines(html: string): ErkhetJournalLine[] | null {
  const head = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(html);
  if (!head) return null;
  const headings = [...(head[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) =>
    cellText(cell[1] ?? '').toLowerCase(),
  );
  const column = (key: string): number => {
    const names = HEADINGS[key] ?? [];
    for (const name of names) {
      const at = headings.indexOf(name);
      if (at >= 0) return at;
    }
    return -1;
  };
  const columns = {
    date: column('date'),
    accountCode: column('accountCode'),
    debit: column('debit'),
    credit: column('credit'),
    description: column('description'),
    billNumber: column('billNumber'),
    customer: column('customer'),
  };
  if (columns.date < 0 || columns.debit < 0 || columns.credit < 0 || columns.customer < 0) {
    return null;
  }
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html.slice(head.index));
  const lines: ErkhetJournalLine[] = [];
  let header: { trId: number; ptrId: number | null } | null = null;
  for (const row of (body?.[1] ?? '').matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attributes = row[1] ?? '';
    const tr = /\btr_id\s*=\s*["']?(\d+)/i.exec(attributes);
    if (tr) {
      const ptr = /:\s*(\d+)/.exec(cellText(row[2] ?? ''));
      header = {
        trId: Number.parseInt(tr[1] ?? '', 10),
        ptrId: ptr ? Number.parseInt(ptr[1] ?? '', 10) : null,
      };
      continue;
    }
    const cells = [...(row[2] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      cellText(cell[1] ?? ''),
    );
    if (cells.length === 0) continue;
    const cell = (at: number): string => (at < 0 ? '' : (cells[at] ?? ''));
    const date = cell(columns.date);
    if (!ISO_DATE.test(date)) throw new ErkhetPageError('a table row of the journal has no date');
    lines.push({
      trId: header?.trId ?? 0,
      ptrId: header?.ptrId ?? null,
      date,
      accountCode: cell(columns.accountCode),
      ...sides(cell(columns.debit), cell(columns.credit)),
      description: cell(columns.description),
      billNumber: cell(columns.billNumber),
      customer: cell(columns.customer),
    });
  }
  return lines;
}

/**
 * The pages of one read, in order, as one list. A page may begin inside a transaction: its leading
 * lines then carry no header and belong to the transaction the page before ended with, which must
 * be the same «Ажил гүйлгээний дугаар» when both name one. Throws when such a line has no
 * transaction to join.
 */
export function joinJournalPages(pages: readonly ErkhetJournalLine[][]): ErkhetJournalLine[] {
  const lines: ErkhetJournalLine[] = [];
  for (const page of pages) {
    for (const line of page) {
      if (line.trId !== 0) {
        lines.push(line);
        continue;
      }
      const before = lines.at(-1);
      if (
        !before ||
        (line.ptrId !== null && before.ptrId !== null && line.ptrId !== before.ptrId)
      ) {
        throw new ErkhetPageError('a line without a transaction header has none to join');
      }
      lines.push({ ...line, trId: before.trId, ptrId: before.ptrId ?? line.ptrId });
    }
  }
  return lines;
}

// ---- the filter form and a transaction's actions -----------------------------------------------

/**
 * Erkhet's internal ids of its accounts by account code, from the journal's filter form: the
 * options of `<select name="account">`, each «код - нэр» with the id as its value.
 */
export function readAccountOptions(content: string): Map<string, string> {
  const select = /<select[^>]*\bname\s*=\s*["']account["'][^>]*>([\s\S]*?)<\/select>/i.exec(
    content,
  );
  if (!select) throw new ErkhetPageError('the filter form has no account list');
  const byCode = new Map<string, string>();
  for (const option of (select[1] ?? '').matchAll(
    /<option[^>]*\bvalue\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<\/option>|<option|$)/gi,
  )) {
    const label = cellText(option[2] ?? '');
    const code = /^(\d+)\s*-/.exec(label)?.[1] ?? /^(\d+)$/.exec(label)?.[1];
    if (code && option[1] && !byCode.has(code)) byCode.set(code, option[1]);
  }
  return byCode;
}

/**
 * The address that opens a transaction in Erkhet, from the answer of its actions: `update_url`
 * and nothing else. The answer's `delete_url` is never read, kept or requested.
 */
export function readUpdateUrl(answer: unknown, companyId: string): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const url = (answer as { update_url?: unknown }).update_url;
  if (typeof url !== 'string') return null;
  const path = url.trim();
  if (!path.startsWith(`/${companyId}/`) || path.length > 500) return null;
  if (/[\s"'<>\\]/.test(path) || /delete/i.test(path)) return null;
  return path;
}
