import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';

/**
 * Asks before leaving a page that holds work not yet sent (ADR-0047 #6): a link or the back button
 * inside the app opens this dialog, closing or reloading the tab gets the browser's own question.
 * Only a change of page asks; filters and steps kept in the URL do not. One per page: a router
 * keeps a single blocker.
 */
export function LeaveGuard(props: {
  when: boolean;
  title: string;
  description: string;
  leaveLabel: string;
}) {
  const { when } = props;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!when) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);
  // The work was sent while the question was open: nothing is lost any more.
  useEffect(() => {
    if (blocker.state === 'blocked' && !when) blocker.proceed();
  }, [blocker, when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={props.title}
      description={props.description}
      confirmLabel={props.leaveLabel}
      onConfirm={() => blocker.proceed?.()}
      onClose={() => blocker.reset?.()}
    />
  );
}
