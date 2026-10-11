import type { ProblemDetails } from '@tugeel/api-client';
import type { ReactNode } from 'react';
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

/** Asks before an action that cannot be undone from the screen (delete, retire, post). */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Posting a document is final but not destructive. */
  variant?: 'default' | 'destructive';
  pending?: boolean;
  problem?: ProblemDetails | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Details shown above the buttons (e.g. what a posting will change). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        {props.children}
        <ProblemAlert problem={props.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            variant={props.variant ?? 'destructive'}
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
