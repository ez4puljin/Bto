import { useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

/**
 * A list page's create dialog lives in the address (`?new=1`, ADR-0042): the home page and the
 * search can open it, and the browser's back button closes it. Opening it from the page pushes a
 * history entry, so closing steps back; a dialog opened by a link is closed by dropping the
 * parameter. After creating, navigate to the new record with `replace: true`.
 */
export function useCreateParam(value = '1') {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pushed = useRef(false);
  const open = params.get('new') === value;
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        pushed.current = true;
        setParams((previous) => {
          const updated = new URLSearchParams(previous);
          updated.set('new', value);
          return updated;
        });
      } else if (pushed.current) {
        pushed.current = false;
        void navigate(-1);
      } else {
        setParams(
          (previous) => {
            const updated = new URLSearchParams(previous);
            updated.delete('new');
            return updated;
          },
          { replace: true },
        );
      }
    },
    [navigate, setParams, value],
  );
  return [open, setOpen] as const;
}
