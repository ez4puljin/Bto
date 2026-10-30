import { Decimal } from '@tugeel/shared/money';
import { Camera, Check, ImageIcon, ScanSearch, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type InvoiceCheck,
  type InvoiceCheckLine,
  useInvoiceChecks,
  useRunInvoiceCheck,
} from './api';

const STATUS_VARIANT: Record<
  InvoiceCheckLine['status'],
  'success' | 'warning' | 'destructive' | 'secondary'
> = {
  MATCH: 'success',
  QTY_DIFF: 'warning',
  PRICE_DIFF: 'warning',
  NOT_ORDERED: 'destructive',
  MISSING: 'destructive',
  UNREADABLE: 'secondary',
};

/**
 * «Падаан шалгах» (ADR-0122): the supplier's invoice photographed, read by the model and compared
 * with the ordered lines; every difference shows both sides with the model's explanation. The
 * last checks of the supplier stay under the card; the photo opens in a new tab.
 */
export function InvoiceCheckPanel(props: {
  orderId: number;
  supplierId: number;
  supplierName: string;
  canRun: boolean;
  canPrices: boolean;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const checks = useInvoiceChecks(props.orderId, props.supplierId);
  const run = useRunInvoiceCheck();
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const list = checks.data ?? [];
  const current = list.find((check) => check.id === shown) ?? list[0] ?? null;

  const attach = (file: File | undefined) => {
    if (!file) return;
    void action.run(async () => {
      const fileId = await uploadFile(api, 'procurement.invoice_image', file);
      const check = await run.mutateAsync({
        id: props.orderId,
        supplierId: props.supplierId,
        fileId,
      });
      setShown(check.id);
      toast.success(
        t(
          check.status === 'DONE'
            ? 'procurement.overview.invoiceDone'
            : 'procurement.overview.invoiceFailedToast',
        ),
      );
    });
  };
  const view = (check: InvoiceCheck) =>
    void action.run(async () => {
      const { data } = await api.GET('/api/v1/purchase-orders/invoice-checks/{checkId}/image', {
        params: { path: { checkId: check.id } },
        parseAs: 'blob',
      });
      if (!(data instanceof Blob)) throw new Error('the invoice photo did not load');
      window.open(URL.createObjectURL(data), '_blank', 'noopener');
    });

  return (
    <div
      className="flex flex-col gap-3 border-t border-border/80 p-3"
      role="region"
      aria-label={t('procurement.overview.invoiceTitle')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ScanSearch aria-hidden className="size-4 text-muted-foreground" />
        <h3 className="text-[0.875rem] font-semibold">{t('procurement.overview.invoiceTitle')}</h3>
        {props.canRun ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              aria-label={t('procurement.overview.invoiceUpload')}
              onChange={(event) => {
                attach(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              pending={run.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Camera aria-hidden />
              {t('procurement.overview.invoiceUpload')}
            </Button>
          </>
        ) : null}
        {list.length > 1 ? (
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {list.map((check, index) => (
              <Button
                key={check.id}
                variant={check.id === current?.id ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShown(check.id)}
              >
                {formatCount(list.length - index)}
              </Button>
            ))}
          </span>
        ) : null}
      </div>
      {run.isPending ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('procurement.overview.invoiceRunning')}
        </p>
      ) : null}
      <ProblemAlert problem={action.problem ?? problemFromError(checks.error)} />
      {current ? (
        <CheckResult check={current} canPrices={props.canPrices} onView={() => view(current)} />
      ) : checks.isPending ? null : (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('procurement.overview.invoiceNone')}
        </p>
      )}
    </div>
  );
}

function CheckResult({
  check,
  canPrices,
  onView,
}: {
  check: InvoiceCheck;
  canPrices: boolean;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const result = check.result;
  const diff =
    check.invoiceTotal !== null && check.orderedTotal !== null
      ? new Decimal(check.invoiceTotal).minus(check.orderedTotal)
      : null;
  const differing = result?.lines.filter((line) => line.status !== 'MATCH').length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span>
          {t('procurement.overview.invoiceBy', {
            by: check.createdBy ?? '',
            at: formatUbDateTime(new Date(check.createdAt).getTime()),
          })}
        </span>
        {check.model ? <span className="font-mono">{check.model}</span> : null}
        <Button variant="ghost" size="sm" className="text-link" onClick={onView}>
          <ImageIcon aria-hidden />
          {t('procurement.overview.invoiceView')}
        </Button>
      </div>
      {check.status === 'FAILED' ? (
        <p className="text-[0.8125rem] text-destructive">
          {t('procurement.overview.invoiceFailed', { reason: check.errorReason ?? '' })}
        </p>
      ) : null}
      {check.status === 'PENDING' ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('procurement.overview.invoiceRunning')}
        </p>
      ) : null}
      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canPrices && check.invoiceTotal !== null ? (
              <Stat
                label={t('procurement.overview.invoiceTotal')}
                value={formatTugrik(check.invoiceTotal)}
              />
            ) : null}
            {canPrices && check.orderedTotal !== null ? (
              <Stat
                label={t('procurement.overview.orderedTotal')}
                value={formatTugrik(check.orderedTotal)}
              />
            ) : null}
            {canPrices && diff !== null ? (
              <Stat
                label={t('procurement.overview.invoiceDiffAmount')}
                value={formatTugrik(diff.toFixed(2))}
                tone={diff.isZero() ? 'success' : 'warning'}
              />
            ) : null}
            {result.invoiceLineCount !== null ? (
              <Stat
                label={t('procurement.overview.invoiceLines')}
                value={formatCount(result.invoiceLineCount)}
              />
            ) : null}
            {differing === 0 && result.totalsMatch ? (
              <Badge variant="success">
                <Check />
                {t('procurement.overview.invoiceMatch')}
              </Badge>
            ) : (
              <Badge variant="warning">
                <TriangleAlert />
                {t('procurement.overview.invoiceDiff', { count: differing })}
              </Badge>
            )}
          </div>
          <div className="rounded-lg bg-info-soft/60 px-3 py-2 text-[0.8125rem] whitespace-pre-wrap">
            <span className="font-medium">{t('procurement.overview.invoiceSummary')}: </span>
            {result.summary}
          </div>
          {result.lines.length > 0 ? (
            <div className="overflow-auto rounded-lg border border-border/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('procurement.overview.invoiceCols.status')}</TableHead>
                    <TableHead>{t('procurement.detail.columns.sku')}</TableHead>
                    <TableHead>{t('procurement.overview.invoiceCols.name')}</TableHead>
                    <TableHead className="text-right">
                      {t('procurement.overview.invoiceCols.orderedQty')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('procurement.overview.invoiceCols.invoiceQty')}
                    </TableHead>
                    {canPrices ? (
                      <>
                        <TableHead className="text-right">
                          {t('procurement.overview.invoiceCols.price')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('procurement.overview.invoiceCols.amount')}
                        </TableHead>
                      </>
                    ) : null}
                    <TableHead>{t('procurement.overview.invoiceCols.note')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.lines.map((line, index) => (
                    <TableRow
                      key={`${line.productId ?? 'x'}-${index}`}
                      className={cn(line.status !== 'MATCH' && 'bg-warning-soft/30')}
                    >
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[line.status]}>
                          {t(`procurement.overview.invoiceStatus.${line.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{line.sku ?? ''}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">{line.invoiceName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {line.orderedQty === null
                          ? ''
                          : `${formatQty(line.orderedQty)} ${line.orderedUnit ?? ''}`}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {line.invoiceQty === null ? '' : formatQty(line.invoiceQty)}
                      </TableCell>
                      {canPrices ? (
                        <>
                          <TableCell className="text-right font-mono">
                            {line.invoiceUnitPrice === null
                              ? ''
                              : formatTugrik(new Decimal(line.invoiceUnitPrice).toFixed(2))}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.invoiceAmount === null
                              ? ''
                              : formatTugrik(new Decimal(line.invoiceAmount).toFixed(2))}
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell className="max-w-[22rem] text-[0.75rem] text-muted-foreground">
                        {line.note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <span className="flex flex-col rounded-lg bg-fill/60 px-3 py-1.5">
      <span className="text-[0.6875rem] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-mono text-[0.875rem] font-semibold',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </span>
    </span>
  );
}
