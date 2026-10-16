import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** A secret shown once (an edge token, a pairing code): copy it now, it is never read back. */
export function OneTimeCodeDialog(props: {
  open: boolean;
  title: string;
  description: string;
  code: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
    } catch {
      // Clipboard refused: the code stays on screen and selectable.
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) return;
        setCopied(false);
        props.onClose();
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-fill px-3 py-3 text-center font-mono text-lg font-semibold break-all select-all">
          {props.code}
        </p>
        <DialogFooter closeLabel={t('common.close')}>
          {canCopy ? (
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
