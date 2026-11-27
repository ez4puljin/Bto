import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { LoadMore } from '@/components/list';
import { PanelSection } from '@/components/record-sheet';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { formatUbMinute } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import type { ExpiryItem } from './api';
import { useExpirySalesHistory } from './commerce-api';

export function ExpirySalesSection({ item }: { item: ExpiryItem }) {
  const { t } = useTranslation();
  const allowed = useHasPermission('inventory.costs.manage');
  const history = useExpirySalesHistory(item.id, allowed);
  if (!allowed) return null;
  const rows = history.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <PanelSection title={t('expiry.salesHistory.title')}>
      <p className="mb-2 text-xs text-muted-foreground">{t('expiry.salesHistory.hint')}</p>
      <ProblemAlert problem={problemFromError(history.error)} onRetry={history.refetch} />
      {history.isPending ? <p>{t('common.loading')}</p> : null}
      {!history.isPending && !history.error && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('expiry.salesHistory.empty')}</p>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <article key={`${row.kind}:${row.id}`} className="rounded-lg border p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Badge variant={row.kind === 'RETURN' ? 'warning' : 'secondary'}>
                {t(`expiry.salesHistory.${row.kind}`)}
              </Badge>
              <time dateTime={row.occurredAt}>{formatUbMinute(row.occurredAt)}</time>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">{t('expiry.salesHistory.qty')}</dt>
              <dd className="font-mono">
                {t('inventory.qtyWithUnit', {
                  qty: formatQty(row.qtyBase),
                  unit: item.product.baseUomName,
                })}
              </dd>
              <dt className="text-muted-foreground">{t('expiry.salesHistory.point')}</dt>
              <dd>
                {row.contextName ?? t('expiry.salesHistory.contextFallback', { id: row.contextId })}{' '}
                · {t(`expiry.commerce.channels.${row.channel}`)}
                {row.contextName === null ? (
                  <>
                    <br />
                    {row.warehouseName ?? `#${row.warehouseId}`}
                  </>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">{t('expiry.salesHistory.unitPrice')}</dt>
              <dd className="font-mono">
                {row.unitPrice === null
                  ? t('expiry.salesHistory.unknownMoney')
                  : formatMnt(row.unitPrice)}
              </dd>
              <dt className="text-muted-foreground">{t('expiry.salesHistory.total')}</dt>
              <dd className="font-mono">
                {row.totalAmount === null
                  ? t('expiry.salesHistory.unknownMoney')
                  : formatMnt(row.totalAmount)}
              </dd>
            </dl>
            {row.kind === 'RETURN' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('expiry.salesHistory.refundUnknown')}
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('expiry.salesHistory.namesHint')}</p>
      ) : null}
      <LoadMore query={history} />
    </PanelSection>
  );
}
