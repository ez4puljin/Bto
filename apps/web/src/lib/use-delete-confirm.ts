import { useState } from 'react';
import { useAction } from '@/lib/use-action';

/**
 * Deletes one row after a confirmation (a `ConfirmDialog` opened while `target` is set); the API
 * refuses rows still in use, and the refusal shows in the dialog (`problem`).
 */
export function useDeleteConfirm<T extends { id: number }>(
  remove: (id: number) => Promise<unknown>,
) {
  const action = useAction();
  const [target, setTarget] = useState<T | null>(null);
  return {
    target,
    problem: action.problem,
    ask: (row: T) => {
      action.clear();
      setTarget(row);
    },
    close: () => setTarget(null),
    confirm: () => {
      if (!target) return;
      void action.run(() => remove(target.id)).then((ok) => (ok ? setTarget(null) : undefined));
    },
  };
}
