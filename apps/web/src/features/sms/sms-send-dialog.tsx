import type { SettlementGroup } from '@tugeel/shared/finance';
import {
  renderSmsTemplate,
  SMS_DEFAULT_TEMPLATE,
  SMS_LIMITS,
  SMS_PLACEHOLDER_KEYS,
  smsPlaceholderToken,
  smsSize,
  unknownSmsPlaceholders,
} from '@tugeel/shared/notifications';
import { Decimal } from '@tugeel/shared/money';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import {
  type SettlementSmsCustomer,
  type SmsBatch,
  useSmsBalance,
  useSmsBatch,
  useSmsMutations,
} from './api';
import { useSmsReason } from './sms-text';

const tugrik = (value: number) => formatTugrik(String(value));

/**
 * «SMS илгээх» (ADR-0216): one text with placeholders for every ticked customer, a preview with
 * the first one's data, the parts and the cost (the longest text's parts, the sum for all), WeSend's
 * balance; «Илгээх» asks once, then follows the batch until it is done. The dialog may be closed
 * while it sends: the worker goes on and «Түүх» shows the result.
 */
export function SmsSendDialog(props: {
  group: SettlementGroup;
  dueDate: string;
  customers: SettlementSmsCustomer[];
  onlyWithBalance: boolean;
  onClose: () => void;
  onSent: () => void;
  onOpenHistory: () => void;
}) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState(SMS_DEFAULT_TEMPLATE);
  const [confirming, setConfirming] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  // One key per press of «Илгээх» in this dialog: a retry after a lost answer sends nothing twice.
  const [key] = useState(() => crypto.randomUUID());
  const area = useRef<HTMLTextAreaElement>(null);
  const balance = useSmsBalance(batchId === null);
  const { send } = useSmsMutations();

  const recipients = props.customers.filter(
    (row) => row.phone !== null && (!props.onlyWithBalance || new Decimal(row.balance).gt(0)),
  );
  const texts = recipients.map((row) => {
    const text = renderSmsTemplate(template, {
      name: row.name,
      code: row.code,
      balance: row.balance,
      dueDate: props.dueDate,
    });
    return { row, text, size: smsSize(text) };
  });
  const first = texts[0];
  const longest = texts.reduce<(typeof texts)[number] | undefined>(
    (best, entry) => (!best || entry.size.parts > best.size.parts ? entry : best),
    undefined,
  );
  const totalCost = texts.reduce((sum, entry) => sum + entry.size.cost, 0);
  const unknown = unknownSmsPlaceholders(template);
  const tooLong = texts.find((entry) => entry.size.tooLong);
  const blank = template.trim().length === 0;
  const credits = balance.data?.ok ? balance.data.balance : null;
  const blocked = blank || unknown.length > 0 || tooLong !== undefined || texts.length === 0;

  const insert = (token: string) => {
    const box = area.current;
    const start = box?.selectionStart ?? template.length;
    const end = box?.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    if ([...next].length > SMS_LIMITS.templateMax) return;
    setTemplate(next);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = async () => {
    const batch = await settle(
      send.mutateAsync({
        key,
        group: props.group,
        customerIds: props.customers.map((row) => row.customerId),
        template,
        onlyWithBalance: props.onlyWithBalance,
      }),
    );
    setConfirming(false);
    if (batch) {
      setBatchId(batch.id);
      props.onSent();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        size="xl"
        closeLabel={t('common.close')}
        guard={batchId === null}
        dirty={batchId === null && template !== SMS_DEFAULT_TEMPLATE}
      >
        <DialogHeader>
          <DialogTitle>{t('sms.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('sms.dialog.description', { count: formatCount(props.customers.length) })}
          </DialogDescription>
        </DialogHeader>
        {batchId !== null ? (
          <BatchProgress batchId={batchId} onOpenHistory={props.onOpenHistory} />
        ) : (
          <div className="@container">
            <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                <FormField
                  label={t('sms.dialog.text')}
                  htmlFor="sms-template"
                  error={
                    unknown.length > 0
                      ? t('sms.dialog.unknown', {
                          names: unknown.map((name) => `{${name}}`).join(', '),
                        })
                      : blank
                        ? t('sms.dialog.empty')
                        : undefined
                  }
                >
                  <Textarea
                    id="sms-template"
                    ref={area}
                    rows={6}
                    maxLength={SMS_LIMITS.templateMax}
                    value={template}
                    onChange={(event) => setTemplate(event.target.value)}
                  />
                </FormField>
                <div
                  role="group"
                  aria-label={t('sms.dialog.insert')}
                  className="flex flex-wrap gap-1.5"
                >
                  {SMS_PLACEHOLDER_KEYS.map((placeholder) => (
                    <Button
                      key={placeholder}
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => insert(smsPlaceholderToken(placeholder))}
                    >
                      {smsPlaceholderToken(placeholder)}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <section aria-label={t('sms.dialog.preview')} className="flex flex-col gap-1">
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    {first
                      ? t('sms.dialog.previewOf', { name: first.row.name })
                      : t('sms.dialog.preview')}
                  </h3>
                  <p className="min-h-20 rounded-lg bg-fill/60 px-3 py-2 text-sm break-words whitespace-pre-wrap">
                    {first?.text ?? ''}
                  </p>
                </section>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Fact
                    label={t('sms.dialog.characters')}
                    value={first ? formatCount(first.size.characters) : '—'}
                    hint={
                      first
                        ? first.size.encoding === 'LATIN'
                          ? t('sms.dialog.encodingLatin')
                          : t('sms.dialog.encodingUnicode')
                        : undefined
                    }
                  />
                  <Fact
                    label={t('sms.dialog.parts')}
                    value={first ? formatCount(first.size.parts) : '—'}
                    hint={
                      longest ? t('sms.dialog.longest', { parts: longest.size.parts }) : undefined
                    }
                  />
                  <Fact
                    label={t('sms.dialog.cost')}
                    value={tugrik(totalCost)}
                    hint={t('sms.dialog.total', {
                      count: formatCount(texts.length),
                      amount: tugrik(totalCost),
                    })}
                  />
                  <Fact
                    label={t('sms.dialog.balance')}
                    value={
                      credits !== null
                        ? tugrik(credits)
                        : balance.isPending
                          ? t('sms.dialog.balanceLoading')
                          : t('sms.dialog.balanceUnknown')
                    }
                  />
                </dl>
                {tooLong ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t('sms.dialog.tooLong', {
                      name: tooLong.row.name,
                      parts: tooLong.size.parts,
                    })}
                  </p>
                ) : credits !== null && totalCost > credits ? (
                  <Alert>
                    <AlertDescription>{t('sms.dialog.overBalance')}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </div>
            <ProblemAlert problem={problemFromError(send.error)} />
          </div>
        )}
        <DialogFooter>
          {batchId === null ? (
            <>
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={blocked}
                pending={send.isPending}
                onClick={() => setConfirming(true)}
              >
                {t('sms.dialog.submit')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('common.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirming}
        variant="default"
        title={t('sms.dialog.confirmTitle', { count: formatCount(texts.length) })}
        description={t('sms.dialog.confirmDescription', { amount: tugrik(totalCost) })}
        confirmLabel={t('sms.dialog.submit')}
        pending={send.isPending}
        onConfirm={() => void submit()}
        onClose={() => setConfirming(false)}
      />
    </Dialog>
  );
}

function Fact(props: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="truncate font-mono font-semibold">{props.value}</dd>
      {props.hint ? <dd className="truncate text-xs text-muted-foreground">{props.hint}</dd> : null}
    </div>
  );
}

/** The batch as the worker sends it: progress, then the counts and the failed customers. */
function BatchProgress(props: { batchId: number; onOpenHistory: () => void }) {
  const { t } = useTranslation();
  const reason = useSmsReason();
  const batch = useSmsBatch(props.batchId);
  const data = batch.data;
  if (!data) {
    return <ProblemAlert problem={problemFromError(batch.error)} onRetry={batch.refetch} />;
  }
  const summary: SmsBatch = data.batch;
  const failed = data.messages.filter((message) => message.status === 'FAILED');
  const done = summary.totalCount - summary.queuedCount;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {summary.status !== 'DONE' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">
            {t('sms.dialog.progress', {
              done: formatCount(done),
              total: formatCount(summary.totalCount),
            })}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{
                width: `${summary.totalCount === 0 ? 0 : (done / summary.totalCount) * 100}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('sms.dialog.progressHint')}</p>
        </div>
      ) : (
        <h3 className="text-sm font-semibold">{t('sms.dialog.result')}</h3>
      )}
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <li className="text-success">{t('sms.dialog.sent', { count: summary.sentCount })}</li>
        <li className={summary.failedCount > 0 ? 'text-destructive' : undefined}>
          {t('sms.dialog.failed', { count: summary.failedCount })}
        </li>
        <li className="text-muted-foreground">
          {t('sms.dialog.skipped', { count: summary.skippedCount })}
        </li>
      </ul>
      {summary.stoppedCode ? (
        <p role="alert" className="text-sm text-destructive">
          {t('sms.dialog.stopped', { reason: reason(summary.stoppedCode) })}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <section aria-label={t('sms.dialog.failedList')} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('sms.dialog.failedList')}
          </h4>
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
            {failed.map((message) => (
              <li
                key={message.id}
                className="flex flex-wrap gap-x-3 border-b border-border/70 px-3 py-1.5 last:border-b-0"
              >
                <span className="font-medium">{message.customerName}</span>
                <span className="font-mono text-muted-foreground">
                  {message.phone?.replace(/^\+976/, '') ?? ''}
                </span>
                <span className="text-destructive">{reason(message.errorCode)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div>
        <Button type="button" variant="link" className="px-0" onClick={props.onOpenHistory}>
          {t('sms.dialog.openHistory')}
        </Button>
      </div>
    </div>
  );
}
