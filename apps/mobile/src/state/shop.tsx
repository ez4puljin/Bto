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
import { readJson, userKey, writeJson } from '../device/storage';

interface ShopValue {
  /** False until the stored cart, stage and pending send are read. */
  ready: boolean;
  cart: Cart;
  dispatch: Dispatch<CartAction>;
  /** The stage new orders land on, chosen in the settings (ADR-0061 #6); null until chosen. */
  stageId: number | null;
  setStageId: (stageId: number | null) => void;
  /** A send whose answer has not come back: its key and body (ADR-0061 #8). */
  pending: PendingSend | null;
  /** Resolves once stored: a send waits for it before the request leaves. */
  setPending: (pending: PendingSend | null) => Promise<void>;
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

/** The rep's cart, chosen stage and pending send, kept on the phone per server and user. */
export function ShopProvider({
  server,
  userId,
  children,
}: {
  server: string;
  userId: number;
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
    void Promise.all([readJson(keys.cart), readJson(keys.stage), readJson(keys.send)]).then(
      ([storedCart, storedStage, storedSend]) => {
        if (!live) return;
        dispatch({ type: 'load', cart: cartFrom(storedCart) });
        setStage(typeof storedStage === 'number' ? storedStage : null);
        setPendingState(isPending(storedSend) ? storedSend : null);
        setReady(true);
      },
    );
    return () => {
      live = false;
    };
  }, [keys]);

  // The cart is written a moment after each change: typing a note does not write every letter.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
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

  const value = useMemo(
    () => ({ ready, cart, dispatch, stageId, setStageId, pending, setPending }),
    [ready, cart, stageId, setStageId, pending, setPending],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error('useShop outside ShopProvider');
  return value;
}
