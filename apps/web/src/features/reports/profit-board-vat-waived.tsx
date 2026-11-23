import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTugrik } from '@/lib/money';
import type { ProfitBoardVatWaived } from './api';
import { NONE } from './report-helpers';

/**
 * «НӨАТ аваагүй борлуулалт» (ADR-0241): the period's sales whose VAT receipt was waived — how many,
 * their total, the VAT inside them, the discount given (by the waiver's date) — and, of the period's
 * invoices by invoice date, the part waived now.
 * Information only: none of it is added to or taken from a profit figure.
 */
export function VatWaivedCard(props: { waived: ProfitBoardVatWaived }) {
  const { t } = useTranslation();
  const { waived } = props;
  const title = t('reports.board.vatWaived.title');
  const facts: { key: string; label: string; value: string }[] = [
    { key: 'count', label: t('reports.board.vatWaived.count'), value: String(waived.count) },
    { key: 'total', label: t('reports.board.vatWaived.total'), value: formatTugrik(waived.total) },
    { key: 'vat', label: t('reports.board.vatWaived.vat'), value: formatTugrik(waived.vat) },
    {
      key: 'discount',
      label: t('reports.board.vatWaived.discount'),
      value: formatTugrik(waived.discount),
    },
    {
      key: 'share',
      label: t('reports.board.vatWaived.share'),
      value: waived.share === null ? NONE : `${waived.share}%`,
    },
  ];
  return (
    <Card role="region" aria-label={title} className="min-w-0 gap-3">
      <CardHeader className="gap-1">
        <CardTitle>{title}</CardTitle>
        <p className="text-[0.75rem] text-muted-foreground">{t('reports.board.vatWaived.hint')}</p>
      </CardHeader>
      <CardContent className="min-w-0">
        {waived.count === 0 ? (
          <EmptyState title={t('reports.board.vatWaived.empty')} />
        ) : (
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(11rem,100%),1fr))] gap-3">
            {facts.map((fact) => (
              <div key={fact.key} className="min-w-0 rounded-lg bg-fill px-3 py-2">
                <dt className="text-[0.75rem] text-muted-foreground">{fact.label}</dt>
                <dd className="truncate font-mono font-semibold" title={fact.value}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
