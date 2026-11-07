import { useEffect } from 'react';
import { type Location, useBlocker } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';

/**
 * Asks before leaving a page that holds work not yet sent (ADR-0047 #6): a link or the back button
 * inside the app opens this dialog, closing or reloading the tab gets the browser's own question.
 * Only a change of page asks; filters and steps kept in the URL do not, unless `leaves` says the
 * work lives in one of them (a record's panel on `?item=`, a create dialog on `?new=1`). One per
 * page: a router keeps a single blocker, so a page with two kinds of work joins them in `when`.
 */
export function LeaveGuard(props: {
  when: boolean;
  title: string;
  description: string;
  leaveLabel: string;
  /** What else leaves the work, on the same page. */
  leaves?: (current: Location, next: Location) => boolean;
}) {
  const { when, leaves } = props;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when &&
      (currentLocation.pathname !== nextLocation.pathname ||
        (leaves?.(currentLocation, nextLocation) ?? false)),
  );
  useEffect(() => {
    if (!when) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);
  // The work was sent while the question was open, or the page's own exit cleared `when` a moment
  // before the blocker heard of it (it hears in an effect): nothing is lost, so nothing is asked.
  useEffect(() => {
    if (blocker.state === 'blocked' && !when) blocker.proceed();
  }, [blocker, when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked' && when}
      title={props.title}
      description={props.description}
      confirmLabel={props.leaveLabel}
      onConfirm={() => blocker.proceed?.()}
      onClose={() => blocker.reset?.()}
    />
  );
}
