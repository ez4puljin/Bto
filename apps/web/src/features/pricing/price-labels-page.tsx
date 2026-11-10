import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  LABEL_SHEET_SPECS,
  LABEL_SHEETS,
  type LabelSheet,
  labelPages,
  parseLabelIds,
  parseLabelSheet,
  saveLabelSheet,
  savedLabelSheet,
  storedLabelIds,
} from './price-labels';

/** Type sizes by sheet: the price is what a shopper reads from the aisle. */
const TYPE: Record<LabelSheet, { name: string; price: string; small: string; pad: string }> = {
  A4_24: {
    name: 'text-[9pt] leading-tight',
    price: 'text-[21pt]',
    small: 'text-[6.5pt]',
    pad: 'px-[3mm] py-[2mm]',
  },
  A4_8: {
    name: 'text-[15pt] leading-tight',
    price: 'text-[46pt]',
    small: 'text-[10pt]',
    pad: 'px-[6mm] py-[5mm]',
  },
  ROLL_58: {
    name: 'text-[9pt] leading-tight',
    price: 'text-[23pt]',
    small: 'text-[6.5pt]',
    pad: 'px-[2.5mm] py-[2mm]',
  },
};

function usePriceLabels(productIds: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['pricing', 'labels', productIds],
    enabled: productIds.length > 0,
    queryFn: async () =>
      unwrap(
        await api.POST('/api/v1/product-prices/labels', { body: { productIds: [...productIds] } }),
      ),
  });
}

/**
 * Supermarket price labels of the ticked products for paper, without the shell (ADR-0182): the
 * name, the supermarket price, the bulk price with its quantity, the code, the unit and the day.
 * The sheet is chosen above the paper and remembered on this computer.
 */
export function PriceLabelsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const ids = useMemo(() => {
    const inAddress = parseLabelIds(search.get('ids'));
    return inAddress.length > 0 ? inAddress : storedLabelIds(search.get('set'));
  }, [search]);
  const [sheet, setSheet] = useState<LabelSheet>(
    () => parseLabelSheet(search.get('sheet')) ?? savedLabelSheet(),
  );
  const labels = usePriceLabels(ids);
  const spec = LABEL_SHEET_SPECS[sheet];
  const type = TYPE[sheet];
  const pages = useMemo(
    () => labelPages(labels.data?.labels ?? [], spec.perPage),
    [labels.data, spec.perPage],
  );
  const title = t('pricing.labels.title');
  useEffect(() => {
    document.title = title;
  }, [title]);
  const choose = (next: LabelSheet) => {
    setSheet(next);
    saveLabelSheet(next);
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        params.set('sheet', next);
        return params;
      },
      { replace: true },
    );
  };
  const count = labels.data?.labels.length ?? 0;
  const missing = labels.data?.missing.length ?? 0;
  return (
    <div className="p-6 text-foreground print:p-0">
      <style>{spec.page}</style>
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2 print:hidden">
        <SegmentedControl
          options={LABEL_SHEETS}
          value={sheet}
          label={(value) => t(`pricing.labels.sheets.${value}`)}
          onChange={choose}
          name={t('pricing.labels.sheet')}
        />
        <Button disabled={count === 0} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
        <Button variant="outline" onClick={() => window.close()}>
          {t('common.close')}
        </Button>
        <span className="text-[0.8125rem] text-muted-foreground">
          {t('pricing.labels.count', { count: formatCount(count) })}
        </span>
      </div>
      <div className="mx-auto mb-4 max-w-4xl space-y-2 print:hidden">
        <ProblemAlert problem={problemFromError(labels.error)} />
        {ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pricing.labels.empty')}</p>
        ) : null}
        {missing > 0 ? (
          <p className="text-sm text-warning">
            {t('pricing.labels.missing', { count: formatCount(missing) })}
          </p>
        ) : null}
        <p className="text-[0.8125rem] text-muted-foreground">{t('pricing.labels.hint')}</p>
      </div>
      {pages.map((page, pageIndex) => (
        <div
          key={page[0]?.productId ?? pageIndex}
          data-testid="label-page"
          className="mx-auto mb-4 grid content-start bg-background shadow-card print:mb-0 print:shadow-none"
          style={{
            width: `${spec.width * spec.columns}mm`,
            gridTemplateColumns: `repeat(${spec.columns}, ${spec.width}mm)`,
            gridAutoRows: `${spec.height}mm`,
            breakAfter: pageIndex === pages.length - 1 ? 'auto' : 'page',
          }}
        >
          {page.map((label) => (
            <div
              key={label.productId}
              data-testid="price-label"
              className={cn(
                'flex flex-col overflow-hidden border border-dashed border-border print:border-transparent',
                type.pad,
              )}
            >
              <div className={cn('line-clamp-2 font-semibold', type.name)}>{label.name}</div>
              <div className={cn('mt-auto leading-none font-bold tabular-nums', type.price)}>
                {formatTugrik(label.retail)}
              </div>
              {label.retailBulk !== null && label.retailBulkMinQty !== null ? (
                <div className={cn('mt-[0.8mm] font-medium', type.name)}>
                  {t('pricing.labels.bulk', {
                    qty: formatQty(label.retailBulkMinQty),
                    unit: label.unitName,
                    price: formatTugrik(label.retailBulk),
                  })}
                </div>
              ) : null}
              <div className={cn('mt-[0.8mm] flex justify-between gap-2', type.small)}>
                <span>{t('pricing.labels.code', { sku: label.sku, unit: label.unitName })}</span>
                <span>{labels.data?.date ?? ''}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
