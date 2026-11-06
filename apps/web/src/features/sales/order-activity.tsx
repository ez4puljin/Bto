import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import type { SalesOrder } from './api';

interface Entry {
  key: string;
  at: number;
  actor: string | null;
  text: string;
  detail?: string | null;
  /** A saved edit's changes, one line each (ADR-0147). */
  rows?: string[];
}

/**
 * What happened to an order (ADR-0059), newest first: who created it and where it landed, every
 * move between stages, every change of state with its reason, the archiving.
 */
export function OrderActivity({ order, limit }: { order: SalesOrder; limit?: number }) {
  const { t } = useTranslation();
  const entries = useMemo(() => {
    const list: Entry[] = [];
    const landing = order.moves.find((move) => move.fromStageId === null);
    list.push({
      key: 'created',
      at: Date.parse(order.createdAt),
      actor: order.createdByName,
      text: landing?.toStageName
        ? t('sales.panel.activity.createdIn', { stage: landing.toStageName })
        : t('sales.panel.activity.created'),
    });
    order.moves.forEach((move, index) => {
      if (move.fromStageId === null) return;
      list.push({
        key: `move:${index}`,
        at: Date.parse(move.createdAt),
        actor: move.actorName,
        text: t('sales.panel.activity.moved', {
          from: move.fromStageName ?? '',
          to: move.toStageName ?? '',
        }),
      });
    });
    order.events.forEach((event, index) => {
      // The creation is the entry above.
      if (event.fromStatus === null) return;
      list.push({
        key: `event:${index}`,
        at: Date.parse(event.createdAt),
        actor: event.actorName,
        text: t('sales.panel.activity.status', { status: t(`sales.statuses.${event.toStatus}`) }),
        detail: event.reason,
      });
    });
    order.changes.forEach((change) => {
      const none = t('common.none');
      const value = (field: string, raw: string | null) => {
        if (raw === null) return none;
        if (field === 'fulfilment') return t(`sales.fulfilments.${raw}` as never);
        if (field === 'paymentMethod') return t(`sales.paymentMethods.${raw}` as never);
        return raw;
      };
      const tugrik = (raw: string | null) => (raw === null ? none : formatTugrik(raw));
      list.push({
        key: `change:${change.version}`,
        at: Date.parse(change.createdAt),
        actor: change.actorName,
        text: t('sales.panel.activity.edited', { version: change.version }),
        rows: [
          ...change.fields.map((row) =>
            t('sales.panel.activity.fieldChanged', {
              field: t(`sales.panel.activity.fields.${row.field}` as never),
              before: value(row.field, row.before),
              after: value(row.field, row.after),
            }),
          ),
          ...change.lines.map((line) => {
            const name = `${line.productName} (${line.unitName})`;
            if (line.kind === 'ADDED') {
              return t('sales.panel.activity.lineAdded', { name, qty: line.qtyAfter ?? none });
            }
            if (line.kind === 'REMOVED') {
              return t('sales.panel.activity.lineRemoved', { name, qty: line.qtyBefore ?? none });
            }
            return t('sales.panel.activity.lineChanged', {
              name,
              before: line.qtyBefore ?? none,
              after: line.qtyAfter ?? none,
            });
          }),
          ...(change.totalBefore !== change.totalAfter
            ? [
                t('sales.panel.activity.totalChanged', {
                  before: tugrik(change.totalBefore),
                  after: tugrik(change.totalAfter),
                }),
              ]
            : []),
        ],
      });
    });
    if (order.archivedAt) {
      list.push({
        key: 'archived',
        at: Date.parse(order.archivedAt),
        actor: null,
        text: t('sales.panel.activity.archived'),
      });
    }
    return list.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key));
  }, [order, t]);
  const shown = limit === undefined ? entries : entries.slice(0, limit);
  const someone = t('sales.panel.activity.someone');

  return (
    <ol className="flex flex-col">
      {shown.map((entry) => {
        const actor = entry.actor ?? someone;
        return (
          <li key={entry.key} className="flex items-start gap-3 py-2">
            <span
              aria-hidden
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-xs font-semibold text-muted-foreground"
            >
              {actor.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-medium">{actor}</span> {entry.text}
              </p>
              {entry.detail ? (
                <p className="text-[0.8125rem] text-muted-foreground">{entry.detail}</p>
              ) : null}
              {entry.rows?.length ? (
                <ul className="mt-0.5 flex flex-col text-[0.8125rem] text-muted-foreground">
                  {entry.rows.map((row) => (
                    <li key={row}>{row}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <time
              className="shrink-0 font-mono text-xs text-muted-foreground"
              dateTime={new Date(entry.at).toISOString()}
            >
              {formatUbDateTime(entry.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
