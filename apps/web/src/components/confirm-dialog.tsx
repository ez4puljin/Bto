import type { ProblemDetails } from '@tugeel/api-client';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Asks before an action that cannot be undone from the screen (delete, retire, post). A `default`
 * confirmation (posting, approving) gives its main button the focus, so Enter confirms; a
 * destructive one keeps «Болих» first in line (ADR-0047 #3). `initialFocus="first"` leaves the
 * focus on the first field of `children` (a reason to type).
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Posting a document is final but not destructive. */
  variant?: 'default' | 'destructive';
  initialFocus?: 'confirm' | 'first';
  pending?: boolean;
  /** Nothing to confirm yet (e.g. nothing chosen). */
  disabled?: boolean;
  problem?: ProblemDetails | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Details shown above the buttons (e.g. what a posting will change). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const confirm = useRef<HTMLButtonElement>(null);
  const variant = props.variant ?? 'destructive';
  const focusConfirm =
    (props.initialFocus ?? (variant === 'default' ? 'confirm' : 'first')) === 'confirm';
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        closeLabel={t('common.close')}
        onOpenAutoFocus={(event) => {
          const button = confirm.current;
          if (!focusConfirm || !button || button.disabled) return;
          event.preventDefault();
          button.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        {props.children}
        <ProblemAlert problem={props.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            ref={confirm}
            variant={variant}
            disabled={props.pending || props.disabled}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
