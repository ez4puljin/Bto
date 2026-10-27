import { useQueryClient } from '@tanstack/react-query';
import { DDTD_PATTERN, POSAPI_DATE_PATTERN } from '@tugeel/shared/mn';
import type {
  EdgeApproval,
  EdgeEbarimtGroup,
  EdgeEbarimtItem,
  PosapiInfoWire,
} from '@tugeel/shared/pos';
import dayjs from 'dayjs';
import { Printer, RotateCcw, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { useCredentials, useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { kioskKeys, useEbarimtQueue } from '../queries';
import { type ApprovalRequest, ApprovalForm } from './approval-dialog';
import { KioskAlert } from './layout';
import { useReprint } from './print-context';

/** PosAPI's last send older than this, or fewer lotteries than this, is a warning. */
const SEND_WARN_HOURS = 24;
const LOTTERY_WARN = 500;
const GROUP_ORDER: readonly EdgeEbarimtGroup[] = ['READY', 'CHECK', 'ERROR', 'WAITING'];

/**
 * «e-Баримт» (ADR-0065): the store PosAPI's facts and its receipts that need the till — issued
 * late and waiting for their one print with the lottery and QR, unanswered and to be checked on
 * ebarimt.mn (a supervisor says whether it was issued), refused by PosAPI, still waiting for it —
 * and «Татвар руу илгээх».
 */
export function EbarimtDialog(props: {
  open: boolean;
  approvalRequired: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.ebarimt.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.ebarimt.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <EbarimtPanel approvalRequired={props.approvalRequired} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EbarimtPanel({ approvalRequired }: { approvalRequired: boolean }) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const queue = useEbarimtQueue(true);
  const reprint = useReprint();
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [issuedFor, setIssuedFor] = useState<EdgeEbarimtItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: kioskKeys.ebarimt(epoch) });
    void queryClient.invalidateQueries({ queryKey: kioskKeys.health });
    void queryClient.invalidateQueries({ queryKey: kioskKeys.recent(epoch) });
  };

  /** Runs `step` with the supervisor's PIN, or straight away when the store asks for none. */
  const approved = (
    kind: ApprovalRequest['kind'],
    items: ApprovalRequest['items'],
    step: (approval: EdgeApproval | null) => Promise<unknown>,
  ) => {
    setError(null);
    const done = () => {
      setApproval(null);
      setIssuedFor(null);
      refresh();
    };
    if (!approvalRequired) {
      step(null).then(done, (caught: unknown) => setError(problemText(caught)));
      return;
    }
    setApproval({
      kind,
      items,
      run: async (given) => {
        await step(given);
        done();
      },
    });
  };

  if (approval) {
    return <ApprovalForm request={approval} onCancel={() => setApproval(null)} />;
  }
  if (issuedFor) {
    return (
      <IssuedForm
        item={issuedFor}
        onCancel={() => setIssuedFor(null)}
        onSubmit={(ddtd, posapiDate) =>
          approved('EBARIMT_ISSUED', [itemLine(issuedFor, t('posKiosk.ebarimt.unit'))], (given) =>
            client.resolveEbarimt(issuedFor.id, {
              outcome: 'ISSUED',
              ddtd,
              posapiDate,
              approval: given,
            }),
          )
        }
      />
    );
  }
  if (queue.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (queue.isError) return <KioskAlert>{problemText(queue.error)}</KioskAlert>;
  const items = queue.data.items;
  return (
    <div className="space-y-4">
      <PosapiFacts
        info={queue.data.posapi}
        onSend={() => approved('EBARIMT_SEND', [], (given) => client.sendData({ approval: given }))}
      />
      {error ? <KioskAlert>{error}</KioskAlert> : null}
      {reprint.isError ? <KioskAlert>{problemText(reprint.error)}</KioskAlert> : null}
      {items.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground">{t('posKiosk.ebarimt.empty')}</p>
      ) : (
        <div className="max-h-[min(26rem,55svh)] space-y-4 overflow-y-auto">
          {GROUP_ORDER.map((group) => {
            const rows = items.filter((item) => item.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`ebarimt-${group}`} className="space-y-2">
                <h3 id={`ebarimt-${group}`} className="text-sm font-semibold">
                  {t(`posKiosk.ebarimt.groups.${group}`, { count: rows.length })}
                </h3>
                <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
                  {rows.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono font-semibold">
                          {item.number}
                          <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                            {t(`posKiosk.ebarimt.ops.${item.op}`)}
                            {item.receiptType === 'B2B' ? ` · ${t('posKiosk.ebarimt.b2b')}` : ''}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {dayjs(item.soldAt).tz(BUSINESS_TZ).format('MM-DD HH:mm')}
                          {' · '}
                          {formatTugrik(item.total)}
                        </span>
                        {item.message && group !== 'READY' ? (
                          <span className="block text-xs break-words text-warning">
                            {item.message}
                          </span>
                        ) : null}
                      </span>
                      {group === 'READY' ? (
                        <Button
                          variant="default"
                          className="h-10"
                          disabled={reprint.isPending}
                          onClick={() =>
                            reprint.mutate(item.saleClientId, { onSuccess: () => refresh() })
                          }
                        >
                          <Printer />
                          {t('posKiosk.ebarimt.print')}
                        </Button>
                      ) : null}
                      {group === 'CHECK' && item.op === 'ISSUE' ? (
                        <Button
                          variant="outline"
                          className="h-10"
                          onClick={() => setIssuedFor(item)}
                        >
                          {t('posKiosk.ebarimt.issued')}
                        </Button>
                      ) : null}
                      {group === 'CHECK' || group === 'ERROR' ? (
                        <Button
                          variant="outline"
                          className="h-10"
                          onClick={() =>
                            approved(
                              'EBARIMT_RETRY',
                              [itemLine(item, t('posKiosk.ebarimt.unit'))],
                              (given) =>
                                client.resolveEbarimt(item.id, {
                                  outcome: 'NOT_ISSUED',
                                  approval: given,
                                }),
                            )
                          }
                        >
                          <RotateCcw />
                          {group === 'CHECK'
                            ? t('posKiosk.ebarimt.notIssued')
                            : t('posKiosk.ebarimt.retry')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function itemLine(item: EdgeEbarimtItem, unit: string): ApprovalRequest['items'][number] {
  return { name: `${item.number} · ${formatTugrik(item.total)}`, qty: '1', uomName: unit };
}

/** PosAPI's version, its last send to the tax office and the lotteries it has left. */
function PosapiFacts({ info, onSend }: { info: PosapiInfoWire | null; onSend: () => void }) {
  const { t } = useTranslation();
  const sent = info?.lastSentDate ? dayjs.tz(info.lastSentDate, BUSINESS_TZ) : null;
  const late = sent ? dayjs().diff(sent, 'hour') >= SEND_WARN_HOURS : false;
  const fewLotteries =
    info?.leftLotteries !== null && info?.leftLotteries !== undefined
      ? info.leftLotteries < LOTTERY_WARN
      : false;
  return (
    <section
      aria-label={t('posKiosk.ebarimt.posapi')}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-canvas px-4 py-3 text-sm"
    >
      {info?.error ? (
        <p className="w-full text-warning">
          {t('posKiosk.ebarimt.posapiError', { error: info.error })}
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">{t('posKiosk.ebarimt.lastSent')}: </span>
        <span className={late ? 'font-semibold text-warning' : 'font-medium'}>
          {info?.lastSentDate ?? '—'}
        </span>
      </p>
      <p>
        <span className="text-muted-foreground">{t('posKiosk.ebarimt.lotteries')}: </span>
        <span className={fewLotteries ? 'font-semibold text-warning' : 'font-medium'}>
          {info?.leftLotteries ?? '—'}
        </span>
      </p>
      <p className="text-muted-foreground">{info?.version ? `PosAPI ${info.version}` : null}</p>
      <Button variant="outline" className="ml-auto h-10" onClick={onSend}>
        <Send />
        {t('posKiosk.ebarimt.sendData')}
      </Button>
    </section>
  );
}

/** «Гарсан»: the ДДТД and the date ebarimt.mn shows for the unanswered receipt. */
function IssuedForm(props: {
  item: EdgeEbarimtItem;
  onCancel: () => void;
  onSubmit: (ddtd: string, posapiDate: string) => void;
}) {
  const { t } = useTranslation();
  const [ddtd, setDdtd] = useState('');
  const [date, setDate] = useState('');
  const valid = DDTD_PATTERN.test(ddtd.trim()) && POSAPI_DATE_PATTERN.test(date.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) props.onSubmit(ddtd.trim(), date.trim());
  };
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <p className="text-sm">{t('posKiosk.ebarimt.issuedHelp', { number: props.item.number })}</p>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t('posKiosk.ebarimt.ddtd')}</span>
        <Input
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          maxLength={40}
          className="h-11 font-mono"
          value={ddtd}
          onChange={(event) => setDdtd(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t('posKiosk.ebarimt.date')}</span>
        <Input
          autoComplete="off"
          maxLength={19}
          placeholder="2026-10-26 14:05:00"
          className="h-11 font-mono"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="h-11" disabled={!valid}>
          {t('posKiosk.ebarimt.saveIssued')}
        </Button>
      </div>
    </form>
  );
}
