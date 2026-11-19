import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { type Cart, type CartAction, cartFrom, cartReducer, EMPTY_CART } from '../cart/cart';
import type { PendingSend } from '../cart/send';
import { readJson, setJson, userKey, writeJson } from '../device/storage';

interface ShopValue {
  /** False until the stored cart, stage and pending send are read. */
  ready: boolean;
  cart: Cart;
  dispatch: Dispatch<CartAction>;
  /** The stage new orders land on, chosen in the settings (ADR-0061 #6); null until chosen. */
  stageId: number | null;
  setStageId: (stageId: number | null) => void;
  /**
   * A send whose answer has not come back: its key and body (ADR-0061 #8). «Bto300» only: the
   * staff app's orders wait in the outbox (owner 2026-11-19) and this stays null there.
   */
  pending: PendingSend | null;
  /** Resolves once stored: a send waits for it before the request leaves. */
  setPending: (pending: PendingSend | null) => Promise<void>;
  /**
   * Replaces the cart once it is on the phone (no 300 ms wait); rejects, leaving the cart as it
   * was, when it cannot be written. «Засах» stores the order's cart before its entry goes.
   */
  saveCart: (cart: Cart) => Promise<void>;
  /** Where the cart is stored: the outbox writes the emptied cart in the same write as an entry. */
  cartKey: string;
}

const ShopContext = createContext<ShopValue | null>(null);

function isPending(value: unknown): value is PendingSend {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PendingSend).key === 'string' &&
    typeof (value as PendingSend).body === 'string' &&
    typeof (value as PendingSend).startedAt === 'string'
  );
}

/**
 * The rep's cart, chosen stage and pending send, kept on the phone per server and user. The staff
 * app passes `keepsPending={false}`: its orders go through the outbox (`src/state/outbox.tsx`),
 * which takes over a pending send left in the old store, and nothing here locks the cart.
 */
export function ShopProvider({
  server,
  userId,
  keepsPending = true,
  children,
}: {
  server: string;
  userId: number;
  keepsPending?: boolean;
  children: ReactNode;
}) {
  const [cart, dispatch] = useReducer(cartReducer, EMPTY_CART);
  const [stageId, setStage] = useState<number | null>(null);
  const [pending, setPendingState] = useState<PendingSend | null>(null);
  const [ready, setReady] = useState(false);
  const keys = useMemo(
    () => ({
      cart: userKey('cart', server, userId),
      stage: userKey('stage', server, userId),
      send: userKey('send', server, userId),
    }),
    [server, userId],
  );

  useEffect(() => {
    let live = true;
    void Promise.all([
      readJson(keys.cart),
      readJson(keys.stage),
      keepsPending ? readJson(keys.send) : Promise.resolve(null),
    ]).then(([storedCart, storedStage, storedSend]) => {
      if (!live) return;
      dispatch({ type: 'load', cart: cartFrom(storedCart) });
      setStage(typeof storedStage === 'number' ? storedStage : null);
      setPendingState(isPending(storedSend) ? storedSend : null);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [keys, keepsPending]);

  // The cart is written a moment after each change: typing a note does not write every letter.
  // An emptied cart (an order handed to the outbox) is written at once: it must never come back.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    if (cart.lines.length === 0) {
      void writeJson(keys.cart, cart);
      return;
    }
    timer.current = setTimeout(() => void writeJson(keys.cart, cart), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [cart, keys, ready]);

  const setStageId = useCallback(
    (value: number | null) => {
      setStage(value);
      void writeJson(keys.stage, value);
    },
    [keys],
  );

  const setPending = useCallback(
    async (value: PendingSend | null) => {
      setPendingState(value);
      await writeJson(keys.send, value);
    },
    [keys],
  );

  const saveCart = useCallback(
    async (next: Cart) => {
      await setJson(keys.cart, next);
      dispatch({ type: 'load', cart: next });
    },
    [keys],
  );

  const value = useMemo(
    () => ({
      ready,
      cart,
      dispatch,
      stageId,
      setStageId,
      pending,
      setPending,
      saveCart,
      cartKey: keys.cart,
    }),
    [ready, cart, stageId, setStageId, pending, setPending, saveCart, keys.cart],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error('useShop outside ShopProvider');
  return value;
}
