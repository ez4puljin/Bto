import { Decimal } from '@tugeel/shared/money';
import type { EdgeCardAttempt, EdgeCardAttemptResult } from '@tugeel/shared/pos';
import { randomUuid } from '@/lib/uuid';
import { type EdgeClient, edgeProblemOf } from './edge-client';
import type { CardTerminalClient, TerminalOutcome } from './khan-terminal';

/**
 * One card charge at the till (ADR-0208), in the only order that leaves a trace of everything:
 *
 * 1. the terminal is asked whether it is ready (no transaction) — if not, nothing is sent;
 * 2. the edge writes the charge PENDING and gives its reference — refused while the till's
 *    earlier charge has no answer;
 * 3. the terminal is asked for the money, once, and waited for as long as it takes;
 * 4. the edge is told how it ended, with the terminal's whole answer.
 *
 * A charge sent and not answered stays PENDING: it is never sent again by itself.
 */
/** An answer the terminal (or its service) gave. */
export type AnsweredOutcome = Exclude<TerminalOutcome, { outcome: 'UNKNOWN' }>;

export type ChargeResult =
  /** The terminal took the money and the edge knows. */
  | { kind: 'APPROVED'; attempt: EdgeCardAttempt }
  /** The terminal (or its service) said no; recorded. The cashier may try again. */
  | { kind: 'REFUSED'; message: string | null }
  /** The terminal is not ready: nothing was sent, nothing written. */
  | { kind: 'OFFLINE' }
  /** The edge would not begin: an earlier charge of this till has no answer (or another refusal). */
  | { kind: 'BLOCKED'; error: unknown }
  /** Sent, no answer. The attempt stays PENDING; the terminal's slip decides. */
  | { kind: 'UNKNOWN'; attempt: EdgeCardAttempt }
  /** The terminal answered but the edge could not be told; `retry` tells it again. */
  | { kind: 'UNRECORDED'; attempt: EdgeCardAttempt; outcome: AnsweredOutcome };

const RECORD_TRIES = 3;
const RECORD_WAIT_MS = 800;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resultOf(outcome: AnsweredOutcome): EdgeCardAttemptResult {
  return {
    outcome: outcome.outcome,
    source: 'TERMINAL',
    response: outcome.response,
    message: outcome.outcome === 'APPROVED' ? null : outcome.message,
  };
}

/** Tells the edge how a charge ended; a few tries, since the money has already moved. */
export async function recordOutcome(
  client: EdgeClient,
  attempt: EdgeCardAttempt,
  outcome: AnsweredOutcome,
  pause: (ms: number) => Promise<unknown> = wait,
): Promise<ChargeResult> {
  for (let attemptNo = 1; ; attemptNo += 1) {
    try {
      const kept = await client.finishCardAttempt(attempt.id, resultOf(outcome));
      return outcome.outcome === 'APPROVED'
        ? { kind: 'APPROVED', attempt: kept }
        : { kind: 'REFUSED', message: outcome.message };
    } catch (error) {
      // A refusal is an answer; only an edge that did not answer is asked again.
      if (edgeProblemOf(error).code !== 'NETWORK' || attemptNo >= RECORD_TRIES) {
        return { kind: 'UNRECORDED', attempt, outcome };
      }
      await pause(RECORD_WAIT_MS);
    }
  }
}

export async function chargeOnTerminal(
  services: { client: EdgeClient; terminal: CardTerminalClient },
  charge: {
    saleClientId: string;
    paymentTypeId: number;
    /** Wire money (`12500.00`). */
    amount: string;
    billType: '1' | '3';
  },
): Promise<ChargeResult> {
  const { client, terminal } = services;
  let terminalId: string | null;
  try {
    terminalId = (await terminal.checkStatus()).terminalId;
  } catch {
    return { kind: 'OFFLINE' };
  }
  let attempt: EdgeCardAttempt;
  try {
    attempt = await client.beginCardAttempt({
      id: randomUuid(),
      saleClientId: charge.saleClientId,
      paymentTypeId: charge.paymentTypeId,
      amount: charge.amount,
      terminalId,
    });
  } catch (error) {
    return { kind: 'BLOCKED', error };
  }
  const outcome = await terminal.sale({
    refNo: attempt.refNo,
    amount: charge.amount,
    billType: charge.billType,
  });
  if (outcome.outcome === 'UNKNOWN') return { kind: 'UNKNOWN', attempt };
  const result = await recordOutcome(client, attempt, outcome);
  // The sale's own answer was not seen to carry the RRN and the card: when it does not, the
  // terminal is asked once about the reference (free), so the sale's tender can keep them.
  if (result.kind === 'APPROVED' && !result.attempt.details?.rrn) {
    const looked = await lookupOnTerminal(services, result.attempt);
    if (looked.kind === 'APPROVED' || looked.kind === 'NONE') {
      return { kind: 'APPROVED', attempt: looked.attempt };
    }
  }
  return result;
}

/**
 * What asking the terminal about a charge's reference came to (`getLastTransaction`; no money
 * moves). The terminal's answer is kept on the edge with the charge.
 */
export type LookupResult =
  /** The terminal holds it approved. A charge that had no answer is APPROVED now. */
  | { kind: 'APPROVED'; attempt: EdgeCardAttempt }
  /**
   * The terminal holds no such transaction. A charge without an answer STAYS so: the card may
   * still be in the terminal, so only the cashier, seeing the terminal idle, says it was not paid.
   */
  | { kind: 'NONE'; attempt: EdgeCardAttempt }
  /** The terminal holds one for another amount: nothing is decided from it. */
  | { kind: 'MISMATCH'; amount: string | null }
  /** No usable answer from the terminal, or one the till cannot read. */
  | { kind: 'UNKNOWN'; message: string | null }
  /** The edge could not keep the answer. */
  | { kind: 'ERROR'; error: unknown };

export async function lookupOnTerminal(
  services: { client: EdgeClient; terminal: CardTerminalClient },
  attempt: EdgeCardAttempt,
): Promise<LookupResult> {
  const { client, terminal } = services;
  const found = await terminal.lookup(attempt.refNo);
  if (found.found === 'UNKNOWN' || found.found === 'OTHER') {
    return { kind: 'UNKNOWN', message: found.message };
  }
  try {
    if (found.found === 'NONE') {
      return { kind: 'NONE', attempt: await client.saveCardLookup(attempt.id, found.response) };
    }
    if (attempt.kind === 'SALE' && !sameAmount(found.amount, attempt.amount)) {
      return { kind: 'MISMATCH', amount: found.amount };
    }
    const kept = await client.saveCardLookup(attempt.id, found.response);
    if (kept.status !== 'PENDING') return { kind: 'APPROVED', attempt: kept };
    // The terminal itself says the money was taken: the unanswered charge is approved.
    return {
      kind: 'APPROVED',
      attempt: await client.finishCardAttempt(attempt.id, {
        outcome: 'APPROVED',
        source: 'TERMINAL',
        response: null,
        message: null,
      }),
    };
  } catch (error) {
    return { kind: 'ERROR', error };
  }
}

function sameAmount(told: string | null, amount: string): boolean {
  if (told === null || !/^\d+(\.\d+)?$/.test(told)) return false;
  return new Decimal(told).eq(amount);
}

/** The terminal's settlement with the bank, kept on the edge like a charge. */
export async function settleOnTerminal(services: {
  client: EdgeClient;
  terminal: CardTerminalClient;
}): Promise<ChargeResult> {
  const { client, terminal } = services;
  let terminalId: string | null;
  try {
    terminalId = (await terminal.checkStatus()).terminalId;
  } catch {
    return { kind: 'OFFLINE' };
  }
  let attempt: EdgeCardAttempt;
  try {
    attempt = await client.beginCardSettlement({ id: randomUuid(), terminalId });
  } catch (error) {
    return { kind: 'BLOCKED', error };
  }
  const outcome = await terminal.settlement(attempt.refNo);
  if (outcome.outcome === 'UNKNOWN') return { kind: 'UNKNOWN', attempt };
  return recordOutcome(client, attempt, outcome);
}
