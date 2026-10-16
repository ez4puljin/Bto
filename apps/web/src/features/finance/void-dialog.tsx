import type { ProblemDetails } from '@tugeel/api-client';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
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
import { Textarea } from '@/components/ui/textarea';

/**
 * «Хүчингүй болгох» with its reason (ADR-0060 #3, #5): the record is reversed, never deleted. The
 * same dialog writes a journal entry's reversal with its own button (`submitLabel`); both buttons
 * are destructive unless asked otherwise.
 */
export function VoidDialog(props: {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  problem: ProblemDetails | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  /** The main button; «Хүчингүй болгох» unless named. */
  submitLabel?: string;
  variant?: 'destructive' | 'default';
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) props.onConfirm(reason.trim());
  };
  return (
    <Dialog open={props.open} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={t('finance.fields.reason')} htmlFor="void-reason">
            <Textarea
              id="void-reason"
              value={reason}
              required
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <ProblemAlert problem={props.problem} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={props.variant ?? 'destructive'}
              disabled={props.pending || !reason.trim()}
            >
              {props.submitLabel ?? t('finance.actions.void')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
