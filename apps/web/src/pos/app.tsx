import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EdgeSession, EdgeShiftSummary } from '@tugeel/shared/pos';
import { useCallback, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/lib/i18n';
import { type Cart, useCart } from './cart';
import { ErrorScreen, LoadingScreen } from './components/layout';
import { KioskContext, type KioskServices, useCredentials, useKiosk } from './kiosk-context';
import { useProblemText } from './messages';
import { useSession } from './queries';
import { LoginScreen } from './screens/login-screen';
import { PairingScreen } from './screens/pairing-screen';
import { SaleScreen } from './screens/sale-screen';
import { ShiftCloseScreen, ShiftSummaryScreen } from './screens/shift-close-screen';
import { ShiftOpenScreen } from './screens/shift-open-screen';

/**
 * The cashier's till screen (`pos.html`, ADR-0067): its own full-window app beside the admin,
 * talking only to the store's edge. Pairing → cashier PIN → shift → sales → close.
 */
export function KioskApp(props: { services: KioskServices; queryClient: QueryClient }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={props.queryClient}>
        <KioskContext.Provider value={props.services}>
          <KioskRoot />
        </KioskContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function KioskRoot() {
  const { client, credentials } = useKiosk();
  const { deviceToken, sessionToken } = useCredentials();
  // The cart outlives an expired session: the same cashier signs in again and goes on.
  const cart = useCart();
  const { clear } = cart;
  const signOut = useCallback(() => {
    // The call takes the session token with it before the kiosk forgets the token.
    const logout = client.logout();
    clear();
    credentials.signedOut();
    void logout.catch(() => undefined);
  }, [clear, client, credentials]);

  if (!deviceToken) return <PairingScreen onPaired={clear} />;
  if (!sessionToken) return <LoginScreen onNewCashier={clear} />;
  return <SessionGate cart={cart} onSignOut={signOut} />;
}

function SessionGate(props: { cart: Cart; onSignOut: () => void }) {
  const session = useSession();
  const problemText = useProblemText();
  const [view, setView] = useState<'sale' | 'close'>('sale');
  const [closed, setClosed] = useState<{ session: EdgeSession; summary: EdgeShiftSummary } | null>(
    null,
  );

  if (closed) {
    return (
      <ShiftSummaryScreen
        session={closed.session}
        summary={closed.summary}
        onSignOut={props.onSignOut}
      />
    );
  }
  if (session.isPending) return <LoadingScreen />;
  if (session.isError) {
    return (
      <ErrorScreen message={problemText(session.error)} onRetry={() => void session.refetch()} />
    );
  }
  const current = session.data;
  const shift = current.shift?.status === 'OPEN' ? current.shift : null;
  if (!shift) return <ShiftOpenScreen session={current} onSignOut={props.onSignOut} />;
  if (view === 'close') {
    return (
      <ShiftCloseScreen
        session={current}
        shift={shift}
        cartCount={props.cart.lines.length}
        onCancel={() => setView('sale')}
        onClosed={(summary) => setClosed({ session: current, summary })}
      />
    );
  }
  return (
    <SaleScreen
      session={current}
      cart={props.cart}
      onCloseShift={() => setView('close')}
      onSignOut={props.onSignOut}
    />
  );
}
