import { createHash } from 'node:crypto';
import type { PartyIn, PostBody } from '@tugeel/fin-contract';
import {
  ERKHET_BOOKS,
  type ErkhetLedgerSide,
  type ErkhetLedgerState,
  erkhetPartyOf,
} from '@tugeel/shared/erkhet';
import { Decimal } from '@tugeel/shared/money';
import type { ErkhetJournalLine } from '../../../integrations/erkhet';

// The copy of Erkhet's receivable and payable transactions, as pure rules (ADR-0219): how the
// journal's lines become transactions, what a run does with each, and the document each becomes in
// Bto's books. Nothing here reads a database or reaches Erkhet.

/** The posting key of the party line: Bto's own receivable and payable accounts. */
export const PARTY_KEY: Readonly<Record<ErkhetLedgerSide, 'AR' | 'AP'>> = {
  RECEIVABLE: 'AR',
  PAYABLE: 'AP',
};

export interface StagedLine {
  /** The line's order within its transaction on the account, from 1. */
  n: number;
  /** Empty for a line Erkhet shows without a party. */
  partyCode: string;
  partyName: string;
  debit: Decimal;
  credit: Decimal;
  description: string;
  billNumber: string;
}

/** One Erkhet transaction on one account: the document a copy is made of. */
export interface StagedTr {
  trId: number;
  ptrId: number | null;
  date: string;
  lines: StagedLine[];
  debit: Decimal;
  credit: Decimal;
  /** Changes when anything a copy carries changed in Erkhet. */
  hash: string;
}

/**
 * The journal's lines of one account, as read page after page, grouped into transactions. A
 * transaction's lines keep the order Erkhet lists them in, also when a page ended inside it.
 */
export function groupJournal(lines: readonly ErkhetJournalLine[]): StagedTr[] {
  const byTr = new Map<number, StagedTr>();
  for (const line of lines) {
    let tr = byTr.get(line.trId);
    if (!tr) {
      tr = {
        trId: line.trId,
        ptrId: line.ptrId,
        date: line.date,
        lines: [],
        debit: new Decimal(0),
        credit: new Decimal(0),
        hash: '',
      };
      byTr.set(line.trId, tr);
    }
    const party = erkhetPartyOf(line.customer);
    const debit = new Decimal(line.debit);
    const credit = new Decimal(line.credit);
    tr.lines.push({
      n: tr.lines.length + 1,
      partyCode: party?.code ?? '',
      partyName: party?.name ?? '',
      debit,
      credit,
      description: clean(line.description, 300),
      billNumber: clean(line.billNumber, 60),
    });
    tr.debit = tr.debit.plus(debit);
    tr.credit = tr.credit.plus(credit);
    // A transaction has one date; should Erkhet ever show two, the earliest is the document's.
    if (line.date < tr.date) tr.date = line.date;
  }
  for (const tr of byTr.values()) tr.hash = hashOf(tr);
  return [...byTr.values()];
}

/** What a copy carries of a transaction, hashed: a change of any of it is a new revision. */
export function hashOf(tr: Pick<StagedTr, 'date' | 'lines'>): string {
  const facts = [
    tr.date,
    ...tr.lines.map((line) => [
      line.n,
      line.partyCode,
      line.debit.toFixed(2),
      line.credit.toFixed(2),
      line.description,
      line.billNumber,
    ]),
  ];
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

export interface OpeningSum {
  partyCode: string;
  partyName: string;
  debit: Decimal;
  credit: Decimal;
  lines: number;
}

/** Debit and credit per party over the whole history before the start date: the opening balance. */
export function sumOpening(lines: readonly ErkhetJournalLine[]): OpeningSum[] {
  const byCode = new Map<string, OpeningSum>();
  for (const line of lines) {
    const party = erkhetPartyOf(line.customer);
    const code = party?.code ?? '';
    let sum = byCode.get(code);
    if (!sum) {
      sum = {
        partyCode: code,
        partyName: party?.name ?? '',
        debit: new Decimal(0),
        credit: new Decimal(0),
        lines: 0,
      };
      byCode.set(code, sum);
    }
    sum.debit = sum.debit.plus(line.debit);
    sum.credit = sum.credit.plus(line.credit);
    sum.lines += 1;
  }
  return [...byCode.values()].sort((a, b) => a.partyCode.localeCompare(b.partyCode));
}

// ---- what a run does with one copy -------------------------------------------------------------

/** A copy as the run finds it: what Erkhet shows now beside what Bto's books hold of it. */
export interface CopyFacts {
  /** What Erkhet shows now. */
  hash: string;
  /** The latest complete download no longer held it. */
  gone: boolean;
  state: ErkhetLedgerState;
  /** The hash of what the books hold; null when nothing of it is posted. */
  postedHash: string | null;
  /** The party codes of its lines (an empty code: a line without a party). */
  partyCodes: readonly string[];
}

/**
 * - `POST`: not in the books: post it.
 * - `REVISE`: Erkhet changed it: reverse the posted revision and post the next one.
 * - `REVERSE`: Erkhet no longer has it: reverse it.
 * - `UNMATCH`: it is posted, but Erkhet now names a party Bto does not have: reverse and leave out.
 * - `LEAVE_OUT`: a party of it is not in Bto: nothing is posted until that party exists.
 * - `DROP`: it vanished before it was ever posted.
 * - `NONE`: the books already say what Erkhet says.
 */
export type CopyAction = 'POST' | 'REVISE' | 'REVERSE' | 'UNMATCH' | 'LEAVE_OUT' | 'DROP' | 'NONE';

export function planCopy(copy: CopyFacts, partyKnown: (code: string) => boolean): CopyAction {
  // BLOCKED holds a posted revision that could not be reversed: it is tried again like POSTED.
  const posted = copy.postedHash !== null && (copy.state === 'POSTED' || copy.state === 'BLOCKED');
  if (copy.gone) return posted ? 'REVERSE' : copy.state === 'REVERSED' ? 'NONE' : 'DROP';
  const matched = copy.partyCodes.every((code) => code !== '' && partyKnown(code));
  if (!matched) return posted ? 'UNMATCH' : copy.state === 'UNMATCHED' ? 'NONE' : 'LEAVE_OUT';
  if (!posted) return 'POST';
  return copy.postedHash === copy.hash ? 'NONE' : 'REVISE';
}

export type PlanCounts = Record<CopyAction, number>;

export function countPlan(actions: readonly CopyAction[]): PlanCounts {
  const counts: PlanCounts = {
    POST: 0,
    REVISE: 0,
    REVERSE: 0,
    UNMATCH: 0,
    LEAVE_OUT: 0,
    DROP: 0,
    NONE: 0,
  };
  for (const action of actions) counts[action] += 1;
  return counts;
}

// ---- the documents -----------------------------------------------------------------------------

/** A text as the intake takes it: no control characters, single spaces, cut to its limit. */
export function clean(text: string, max: number): string {
  return [...text]
    .map((char) => ((char.codePointAt(0) ?? 0) < 32 || char.codePointAt(0) === 127 ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

export interface TrPosting {
  docNo: string;
  body: PostBody;
}

/**
 * A transaction as a document of Bto's books: every line with an amount on Bto's receivable (or
 * payable) account under its party, on the side Erkhet shows, and the other side on the clearing
 * account of the copies (the journal list names no counter account). Null when no line carries an
 * amount: there is nothing to post.
 */
export function trPosting(
  tr: Pick<StagedTr, 'trId' | 'ptrId' | 'date' | 'lines'>,
  side: ErkhetLedgerSide,
  account: string,
  partyOf: (code: string) => PartyIn,
): TrPosting | null {
  const key = PARTY_KEY[side];
  const lines: PostBody['lines'] = [];
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  const add = (line: StagedLine, amount: Decimal, lineSide: 'DEBIT' | 'CREDIT') => {
    if (amount.lte(0)) return;
    lines.push({
      lineNo: lines.length + 1,
      key,
      side: lineSide,
      amount: amount.toFixed(2),
      party: partyOf(line.partyCode),
      sourceLineRef: String(line.n),
      ...(line.description ? { description: line.description } : {}),
      // Erkhet settles by balance: an item is due the day it is dated.
      openItem: { itemDate: tr.date, dueDate: tr.date, ...itemRef(line.billNumber) },
    });
    if (lineSide === 'DEBIT') debit = debit.plus(amount);
    else credit = credit.plus(amount);
  };
  for (const line of tr.lines) {
    add(line, line.debit, 'DEBIT');
    add(line, line.credit, 'CREDIT');
  }
  if (lines.length === 0) return null;
  const first = tr.lines[0];
  const description = clean(first?.description ?? '', 300) || `Erkhet ${tr.ptrId ?? tr.trId}`;
  if (debit.gt(0)) lines.push(clearingLine(lines.length + 1, 'CREDIT', debit));
  if (credit.gt(0)) lines.push(clearingLine(lines.length + 1, 'DEBIT', credit));
  const codes = [...new Set(tr.lines.map((line) => line.partyCode))];
  const billNumber = clean(first?.billNumber ?? '', 60);
  return {
    docNo: billNumber || String(tr.ptrId ?? tr.trId),
    body: {
      action: 'POST',
      documentType: ERKHET_BOOKS.trType,
      documentDate: tr.date,
      currency: 'MNT',
      ...(codes.length === 1 && codes[0] ? { party: partyOf(codes[0]) } : {}),
      description,
      controlTotal: debit.plus(credit).toFixed(2),
      lines,
      attributes: {
        erkhetAccount: account,
        erkhetTr: String(tr.trId),
        ...(tr.ptrId === null ? {} : { erkhetPtr: String(tr.ptrId) }),
        ...(billNumber ? { billNumber } : {}),
        ...(first?.description ? { text: clean(first.description, 200) } : {}),
      },
    },
  };
}

/**
 * A party's balance before the start date as an OPENING document: one item dated that day, the
 * other side on the clearing account. Null for a balance of zero.
 */
export function openingPosting(
  opening: { partyCode: string; debit: Decimal; credit: Decimal },
  side: ErkhetLedgerSide,
  account: string,
  through: string,
  party: PartyIn,
): TrPosting | null {
  const net = opening.debit.minus(opening.credit);
  if (net.isZero()) return null;
  const lineSide = net.gt(0) ? 'DEBIT' : 'CREDIT';
  const amount = net.abs();
  return {
    docNo: `${account}-${opening.partyCode}`.slice(0, 60),
    body: {
      action: 'POST',
      documentType: ERKHET_BOOKS.openingType,
      documentDate: through,
      currency: 'MNT',
      party,
      description: `Erkhet ${account} ${through}`,
      controlTotal: amount.toFixed(2),
      lines: [
        {
          lineNo: 1,
          key: PARTY_KEY[side],
          side: lineSide,
          amount: amount.toFixed(2),
          party,
          openItem: { itemDate: through, dueDate: through },
        },
        clearingLine(2, lineSide === 'DEBIT' ? 'CREDIT' : 'DEBIT', amount),
      ],
      attributes: { erkhetAccount: account, erkhetOpening: through },
    },
  };
}

function clearingLine(
  lineNo: number,
  side: 'DEBIT' | 'CREDIT',
  amount: Decimal,
): PostBody['lines'][number] {
  return { lineNo, key: ERKHET_BOOKS.clearingKey, side, amount: amount.toFixed(2) };
}

function itemRef(billNumber: string): { itemRef?: string } {
  const ref = clean(billNumber, 128);
  return ref ? { itemRef: ref } : {};
}

// ---- pairing a party's copied items ------------------------------------------------------------

export interface OpenCopyItem {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  /** Oldest first: the due date, else the item's date. */
  date: string;
  open: Decimal;
}

/**
 * Erkhet settles by balance, so a party's copied credits close its copied debits oldest first:
 * the pairs of one party on one account, at most `max` of them (the rest wait for the next call).
 */
export function pairOldestFirst(
  items: readonly OpenCopyItem[],
  max: number,
): { debitId: number; creditId: number; amount: Decimal }[] {
  const order = (a: OpenCopyItem, b: OpenCopyItem) =>
    a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1;
  const debits = items
    .filter((item) => item.side === 'DEBIT' && item.open.gt(0))
    .map((item) => ({ ...item }))
    .sort(order);
  const credits = items
    .filter((item) => item.side === 'CREDIT' && item.open.gt(0))
    .map((item) => ({ ...item }))
    .sort(order);
  const pairs: { debitId: number; creditId: number; amount: Decimal }[] = [];
  let d = 0;
  let c = 0;
  while (d < debits.length && c < credits.length && pairs.length < max) {
    const debit = debits[d];
    const credit = credits[c];
    if (!debit || !credit) break;
    const amount = Decimal.min(debit.open, credit.open);
    pairs.push({ debitId: debit.id, creditId: credit.id, amount });
    debit.open = debit.open.minus(amount);
    credit.open = credit.open.minus(amount);
    if (debit.open.lte(0)) d += 1;
    if (credit.open.lte(0)) c += 1;
  }
  return pairs;
}
