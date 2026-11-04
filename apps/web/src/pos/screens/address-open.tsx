import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ErrorScreen, LoadingScreen } from '../components/layout';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';

/**
 * ADR-0138: a page opened for one POS (`http://<edge>:7400/K1`) binds this browser to it at once,
 * with no code; the cashier's PIN comes next. Shown again only if the edge forgets the browser.
 */
export function AddressOpen({ tillCode, onOpened }: { tillCode: string; onOpened: () => void }) {
  const { client, credentials } = useKiosk();
  const problemText = useProblemText();
  const open = useMutation({
    mutationFn: () => client.open(tillCode),
    onSuccess: (response) => {
      onOpened();
      credentials.paired(response.deviceToken);
    },
  });
  const { mutate, isIdle } = open;
  useEffect(() => {
    if (isIdle) mutate();
  }, [isIdle, mutate]);

  if (open.isError) {
    return <ErrorScreen message={problemText(open.error)} onRetry={() => open.mutate()} />;
  }
  return <LoadingScreen />;
}
