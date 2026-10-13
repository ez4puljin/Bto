import { AI_REPORT_NAME_MAX_LENGTH } from '@tugeel/shared/ai';
import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { useAction } from '@/lib/use-action';

/**
 * Names a report: saving an answer as a report, or renaming one. The dialog stays open on a
 * refusal and shows it above the buttons.
 */
export function ReportNameDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  initialName: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(props.initialName);
  const [busy, setBusy] = useState(false);
  const action = useAction();
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await action.run(() => props.onSubmit(trimmed));
    setBusy(false);
    if (ok) props.onClose();
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
          </DialogHeader>
          <FormField label={t('ai.report.nameLabel')} htmlFor="ai-report-name">
            <Input
              id="ai-report-name"
              value={name}
              maxLength={AI_REPORT_NAME_MAX_LENGTH}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!trimmed || busy}>
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
