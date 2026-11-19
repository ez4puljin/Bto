import type { AppProblem } from '../api/problem';
import { type Cart, cartReducer } from '../cart/cart';
import type { PendingSend } from '../cart/send';
import { cartOfEntry, entryOf, fromPending } from './entry';
import { type Outbox, OutboxNotRead } from './outbox';

/** What «Захиалга илгээх» came to. */
export type SubmitResult<O> =
  /** On the server (`order` is null only when its answer was not kept). */
  | { kind: 'sent'; order: O | null }
  /** On the phone, waiting for the server. */
  | { kind: 'saved' }
  /**
   * Refused at once. `kept`: the cart could not be stored back, so the entry stays in the outbox
   * (refused, with «Засах») and the cart is empty; otherwise the cart is back as it was.
   */
  | { kind: 'refused'; problem: AppProblem | null; kept: boolean }
  /** Not stored on the phone (`read`: the outbox is unread; `write`: storage failed): the cart is as it was. */
  | { kind: 'notSaved'; reason: 'read' | 'write' };

export interface SubmitDeps<O> {
  outbox: Outbox<O>;
  cart: Cart;
  stageId: number;
  stageName: string | null;
  /** The cart's amount as the phone knew it (the quote, or the estimate): shown «≈» in the list. */
  estimate?: string | null;
  /** Lines the estimate could not price. */
  unpricedLines?: number;
  /** Where the cart is stored: the emptied cart goes in the same write as the entry. */
  cartKey: string;
  key: string;
  now: Date;
  /** The cart in memory emptied (the reducer's `sent`), once both are on the phone. */
  emptyCart: () => void;
  /** Stores a cart and puts it in memory; rejects (nothing changed) when it cannot be stored. */
  saveCart: (cart: Cart) => Promise<void>;
  /** A run of the outbox (the provider's, which also refreshes the lists). */
  run: () => Promise<unknown>;
}

/**
 * «Захиалга илгээх»: the entry and the emptied cart are written in one `multiSet` (a kill can
 * never leave the entry stored and the full cart still there to be sent again under a new key),
 * then the cart is emptied in memory and the outbox runs. A failed write changes nothing. Refused
 * at once, the cart is stored back before the entry goes: the order is never in neither place.
 */
export async function submitOrder<O>(deps: SubmitDeps<O>): Promise<SubmitResult<O>> {
  const { outbox, cart } = deps;
  const entry = entryOf(
    cart,
    deps.stageId,
    deps.stageName,
    deps.key,
    deps.now,
    deps.estimate ?? null,
    deps.unpricedLines ?? 0,
  );
  const emptied = cartReducer(cart, { type: 'sent' });
  try {
    await outbox.add(entry, [[deps.cartKey, JSON.stringify(emptied)]]);
  } catch (error) {
    return { kind: 'notSaved', reason: error instanceof OutboxNotRead ? 'read' : 'write' };
  }
  deps.emptyCart();
  await deps.run();
  const now = outbox.get(entry.id);
  if (now?.status === 'sent') return { kind: 'sent', order: outbox.orderOf(entry.id) ?? null };
  if (now?.status === 'refused') {
    try {
      await deps.saveCart(cart);
    } catch {
      return { kind: 'refused', problem: now.problem, kept: true };
    }
    const removed = await outbox.remove(entry.id).catch(() => false);
    return { kind: 'refused', problem: now.problem, kept: !removed };
  }
  return { kind: 'saved' };
}

/**
 * «Засах»: the entry's cart is stored as the cart first, and only then the entry goes; when the
 * cart cannot be stored nothing changes. Resolves `false` then (or when the entry has no cart).
 */
export async function editEntry<O>(
  outbox: Outbox<O>,
  id: string,
  saveCart: (cart: Cart) => Promise<void>,
): Promise<boolean> {
  const entry = outbox.get(id);
  const back = entry ? cartOfEntry(entry) : null;
  if (!back) return false;
  try {
    await saveCart(back);
  } catch {
    return false;
  }
  // The cart holds it now. A failed remove leaves the entry too (refused or to check: never sent
  // by itself), so the order is in two places, never in none.
  return outbox.remove(id).catch(() => false);
}

/**
 * The old store's pending send (`bto.send.v1`) as an outbox entry, with the locked cart it was
 * made from emptied in the same write. Resolves true once stored (the caller then removes the old
 * key); false, changing nothing, when it cannot be stored now (the next start tries again).
 */
export async function takeOverPending<O>(
  outbox: Outbox<O>,
  pending: PendingSend,
  cart: Cart,
  cartKey: string,
  emptyCart: () => void,
): Promise<boolean> {
  const { entry, cartTaken } = fromPending(pending, cart, null);
  const also: [string, string][] = cartTaken
    ? [[cartKey, JSON.stringify(cartReducer(cart, { type: 'sent' }))]]
    : [];
  try {
    await outbox.add(entry, also);
  } catch {
    return false;
  }
  if (cartTaken) emptyCart();
  return true;
}
