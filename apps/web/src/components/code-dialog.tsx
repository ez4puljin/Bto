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
import { formatUbDateTime } from '@/lib/dayjs';

/**
 * Shows a one-time password code once, so the admin can hand it to the staff member (ADR-0027 #9),
 * with the words to hand over with it: the web's set-password page, then the app.
 */
export function CodeDialog(props: {
  code: { code: string; expiresAt: string } | null;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
  const copy = async () => {
    if (!props.code) return;
    try {
      await navigator.clipboard.writeText(props.code.code);
      setCopied(true);
    } catch {
      // Clipboard refused: the code stays on screen and selectable.
    }
  };
  return (
    <Dialog
      open={props.code !== null}
      onOpenChange={(open) => {
        if (open) return;
        setCopied(false);
        props.onClose();
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('users.code.title')}</DialogTitle>
          <DialogDescription>
            {t('users.code.description', {
              name: props.name,
              time: props.code ? formatUbDateTime(Date.parse(props.code.expiresAt)) : '',
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-center font-mono text-3xl font-semibold tracking-widest select-all">
          {props.code?.code}
        </p>
        {/* What the admin tells the staff member (owner 2026-10-29): the web page, then the app. */}
        <p className="text-sm text-muted-foreground">{t('users.code.handOver')}</p>
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
