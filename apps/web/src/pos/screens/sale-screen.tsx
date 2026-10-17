import { useQueryClient } from '@tanstack/react-query';
import { cleanBarcode } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import type { EdgeProductHit, EdgeQuotedLine, EdgeReceipt, EdgeSession } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { History, LockKeyhole, LogOut, Menu, ScanBarcode, Search, X } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMnt, formatTugrik } from '@/lib/money';
import { isTextField, useWedgeScanner } from '@/lib/scan/use-wedge-scanner';
import { randomUuid } from '@/lib/uuid';
import type { Cart } from '../cart';
import { CartTable } from '../components/cart-table';
import { KioskHeader } from '../components/kiosk-header';
import { KioskAlert } from '../components/layout';
import { type PaymentAttempt, PaymentDialog } from '../components/payment-dialog';
import { ReceiptDialog } from '../components/receipt';
import { RecentDialog } from '../components/recent-dialog';
import { SearchDialog } from '../components/search-dialog';
import { edgeProblemOf } from '../edge-client';
import { useCredentials, useKiosk } from '../kiosk-context';
import { isMinusKey, isPlusKey, keepFocus, typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { kioskKeys, useQuote } from '../queries';

type Dialogs = 'search' | 'pay' | 'receipt' | 'cancel' | 'recent' | null;

/**
 * The till's main screen (Erxes-like): the scanner always adds to the cart, «Бараа хайх (F6)»
 * finds a product by name, the cart in the middle with the edge's prices, the totals and
 * «Төлбөр (F12)» on the right. ↑/↓ select a line, + / − change it, Delete removes it.
 */
export function SaleScreen(props: {
  session: EdgeSession;
  cart: Cart;
  onCloseShift: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const { cart } = props;
  const root = useRef<HTMLDivElement>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const receiptContent = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [receipt, setReceipt] = useState<EdgeReceipt | null>(null);
  // One client id per payment attempt of one cart: a retry after a timeout sends the same id.
  const pending = useRef<{ key: string; clientId: string } | null>(null);

  const quote = useQuote(cart.wire);
  const quoted = useMemo(
    () =>
      new Map<number, EdgeQuotedLine>(
        (quote.data?.lines ?? []).map((line) => [line.productUnitId, line]),
      ),
    [quote.data],
  );
  const fresh =
    cart.lines.length > 0 && quote.isSuccess && !quote.isPlaceholderData && !quote.isFetching;
  const unpriced = fresh && quote.data.lines.some((line) => !line.priced);
  const canPay = fresh && !unpriced && new Decimal(quote.data.total).gt(0);
  const totals = cart.lines.length > 0 ? quote.data : undefined;

  const focusScan = useCallback(() => scanInput.current?.focus(), []);
  const refocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      focusScan();
    },
    [focusScan],
  );

  const addProduct = useCallback(
    (product: EdgeProductHit, unitId: number) => {
      cart.add(product, unitId);
      setScanError(null);
    },
    [cart],
  );

  const scan = useCallback(
    async (text: string) => {
      const code = cleanBarcode(text);
      if (!code) return;
      try {
        const hit = await client.barcode(code);
        addProduct(hit.product, hit.unitId);
      } catch (error) {
        const problem = edgeProblemOf(error);
        setScanError(
          problem.code === 'NOT_FOUND' ? t('scan.notFound', { code }) : problemText(error),
        );
      }
    },
    [client, addProduct, t, problemText],
  );
  const onScan = useCallback((code: string) => void scan(code), [scan]);

  // A scan while focus is outside the scan box (a button, the page) still reaches the cart.
  useWedgeScanner(onScan, dialog === null, { root });
  // A scan over the receipt closes it and starts the next sale with that product.
  useWedgeScanner(
    (code) => {
      setDialog(null);
      onScan(code);
    },
    dialog === 'receipt',
    { root: receiptContent },
  );

  const openPayment = useCallback(() => {
    if (!canPay || !quote.data) return;
    const key = JSON.stringify(cart.wire);
    if (pending.current?.key !== key) pending.current = { key, clientId: randomUuid() };
    setAttempt({ clientId: pending.current.clientId, total: quote.data.total, lines: cart.wire });
    setDialog('pay');
  }, [canPay, quote.data, cart.wire]);

  const paid = (done: EdgeReceipt) => {
    pending.current = null;
    cart.clear();
    setScanError(null);
    setReceipt(done);
    setDialog('receipt');
    void queryClient.invalidateQueries({ queryKey: kioskKeys.session(epoch) });
    void queryClient.invalidateQueries({ queryKey: kioskKeys.recent(epoch) });
  };

  /** ↑/↓, + / − and Delete on the selected line; true when the key was the cart's. */
  const cartKey = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent, editable: boolean) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        cart.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
        return true;
      }
      if (!editable || cart.selected === null) return false;
      if (isPlusKey(event) || isMinusKey(event)) {
        event.preventDefault();
        cart.step(cart.selected, isPlusKey(event) ? 1 : -1);
        return true;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        cart.remove(cart.selected);
        return true;
      }
      return false;
    },
    [cart],
  );

  const keys = useRef({ dialog, openPayment, cartKey });
  useEffect(() => {
    keys.current = { dialog, openPayment, cartKey };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const current = keys.current;
      if (event.key === 'F6' || event.key === 'F12') {
        // F12 would open the browser's tools and F6 its address bar.
        event.preventDefault();
        if (current.dialog !== null) return;
        if (event.key === 'F6') setDialog('search');
        else current.openPayment();
        return;
      }
      if (current.dialog !== null || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || isTextField(event.target)) return;
      const target = event.target;
      if (target instanceof Node && target !== document.body && !root.current?.contains(target)) {
        return;
      }
      current.cartKey(event, true);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const closeDialog = () => setDialog(null);

  return (
    <div ref={root} className="flex h-dvh flex-col bg-canvas">
      <KioskHeader
        session={props.session}
        center={
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full max-w-lg justify-start gap-2 px-4 text-[15px] font-normal text-muted-foreground"
            onMouseDown={keepFocus}
            onClick={() => setDialog('search')}
          >
            <Search className="size-5" />
            {t('posKiosk.header.search')}
          </Button>
        }
        actions={
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-lg"
                aria-label={t('posKiosk.menu.label')}
                title={t('posKiosk.menu.label')}
              >
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={refocus}>
              <DropdownMenuItem className="h-10 text-[15px]" onSelect={() => setDialog('recent')}>
                <History />
                {t('posKiosk.menu.recent')}
              </DropdownMenuItem>
              <DropdownMenuItem className="h-10 text-[15px]" onSelect={props.onCloseShift}>
                <LockKeyhole />
                {t('posKiosk.menu.closeShift')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="h-10 text-[15px]" onSelect={props.onSignOut}>
                <LogOut />
                {t('posKiosk.menu.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <main className="flex min-h-0 flex-1 gap-4 p-4">
        <section aria-labelledby="sale-cart" className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 id="sale-cart" className="sr-only">
            {t('posKiosk.sale.cart')}
          </h1>
          <div className="flex items-center gap-3">
            <div className="relative w-full max-w-md">
              <ScanBarcode
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={scanInput}
                autoFocus
                aria-label={t('posKiosk.sale.scanLabel')}
                placeholder={t('posKiosk.sale.scanPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full rounded-lg border border-input bg-background pr-3 pl-10 font-mono text-base shadow-control outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const text = draft;
                    setDraft('');
                    onScan(text);
                    return;
                  }
                  if (cartKey(event, draft === '')) return;
                  typeDigits(event, draft, setDraft);
                }}
              />
            </div>
            {scanError ? (
              <KioskAlert className="flex min-w-0 flex-1 items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1 truncate">{scanError}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  onMouseDown={keepFocus}
                  onClick={() => setScanError(null)}
                >
                  <X />
                </Button>
              </KioskAlert>
            ) : (
              <p className="hidden min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground xl:block">
                {t('posKiosk.sale.keys')}
              </p>
            )}
          </div>
          <CartTable
            lines={cart.lines}
            quoted={quoted}
            selected={cart.selected}
            onSelect={cart.select}
            onStep={cart.step}
            onSetQty={cart.setQty}
            onRemove={cart.remove}
            onScan={onScan}
            onDone={focusScan}
          />
        </section>
        <aside
          aria-label={t('posKiosk.sale.totals')}
          className="flex w-80 shrink-0 flex-col gap-3 xl:w-96"
        >
          <div className="space-y-3 rounded-xl bg-card p-5 shadow-card ring-1 ring-black/[0.06]">
            <div
              className={cn('space-y-1', fresh || cart.lines.length === 0 ? null : 'opacity-60')}
            >
              <p className="text-[15px] font-medium text-muted-foreground">
                {t('posKiosk.sale.total')}
              </p>
              <p
                data-testid="sale-total"
                className="font-mono text-4xl font-semibold tracking-tight xl:text-5xl"
              >
                {formatTugrik(totals?.total ?? '0')}
              </p>
            </div>
            <dl className="space-y-1.5 border-t border-border pt-3 text-[15px]">
              {totals && new Decimal(totals.discountTotal).gt(0) ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('posKiosk.sale.subtotal')}</dt>
                    <dd className="font-mono">{formatTugrik(totals.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-success">
                    <dt>{t('posKiosk.sale.discount')}</dt>
                    <dd className="font-mono">{`−${formatMnt(totals.discountTotal)}₮`}</dd>
                  </div>
                </>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('posKiosk.sale.vat')}</dt>
                <dd className="font-mono">{formatTugrik(totals?.vatTotal ?? '0')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('posKiosk.sale.lines')}</dt>
                <dd className="font-mono">{cart.lines.length}</dd>
              </div>
            </dl>
          </div>
          {quote.isError && cart.lines.length > 0 ? (
            <KioskAlert>{problemText(quote.error)}</KioskAlert>
          ) : unpriced ? (
            <KioskAlert tone="warning">{t('posKiosk.sale.unpricedBlock')}</KioskAlert>
          ) : null}
          <div className="mt-auto flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 text-base"
              disabled={cart.lines.length === 0}
              onMouseDown={keepFocus}
              onClick={() => setDialog('cancel')}
            >
              <X />
              {t('posKiosk.sale.cancel')}
            </Button>
            <Button
              type="button"
              className="h-16 text-xl font-semibold"
              disabled={!canPay}
              onMouseDown={keepFocus}
              onClick={openPayment}
            >
              {t('posKiosk.sale.pay')}
            </Button>
          </div>
        </aside>
      </main>

      <SearchDialog
        open={dialog === 'search'}
        onClose={closeDialog}
        onCloseAutoFocus={refocus}
        onPick={(product, unitId) => {
          addProduct(product, unitId);
          closeDialog();
        }}
      />
      <PaymentDialog
        open={dialog === 'pay'}
        attempt={attempt}
        onClose={closeDialog}
        onCloseAutoFocus={refocus}
        onPaid={paid}
      />
      <ReceiptDialog
        open={dialog === 'receipt'}
        receipt={receipt}
        contentRef={receiptContent}
        onClose={closeDialog}
        onCloseAutoFocus={refocus}
      />
      <RecentDialog open={dialog === 'recent'} onClose={closeDialog} onCloseAutoFocus={refocus} />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={t('posKiosk.sale.cancelTitle')}
        description={t('posKiosk.sale.cancelDescription', { count: cart.lines.length })}
        confirmLabel={t('posKiosk.sale.cancel')}
        onConfirm={() => {
          cart.clear();
          pending.current = null;
          setScanError(null);
          closeDialog();
          focusScan();
        }}
        onClose={() => {
          closeDialog();
          focusScan();
        }}
      />
    </div>
  );
}
