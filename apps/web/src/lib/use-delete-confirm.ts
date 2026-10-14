import { useState } from 'react';
import { useAction } from '@/lib/use-action';

/**
 * Deletes (or archives) one row after a confirmation: `ask(row)`, then a `ConfirmDialog` open while
 * `target` is set, busy while `pending`; the API's refusal shows in the dialog (`problem`).
 */
export function useDeleteConfirm<T extends { id: number }>(
  remove: (id: number) => Promise<unknown>,
) {
  const action = useAction();
  const [target, setTarget] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  return {
    target,
    pending,
    problem: action.problem,
    ask: (row: T) => {
      action.clear();
      setTarget(row);
    },
    close: () => setTarget(null),
    confirm: () => {
      if (!target || pending) return;
      setPending(true);
      void action
        .run(() => remove(target.id))
        .then((ok) => {
          setPending(false);
          if (ok) setTarget(null);
        });
    },
  };
}
