import type { ProblemDetails } from '@tugeel/api-client';
import { ArrowRight, ImageOff, ScanBarcode } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListCard, ListTable } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { type BarcodeResolution, useBarcodeLookup } from './api';
import { productStage } from './product-stage';
import { ProductStageBadge } from './product-stage-badge';

interface ScanEntry {
  id: number;
  code: string;
  found: BarcodeResolution | null;
  problem: ProblemDetails | null;
}

const RECENT_SCANS = 10;

/** The recent scans' columns (ADR-0119): the barcode, the product (wrapping), its unit. */
const RECENT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'number', width: 11 },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'unit', kind: 'text', weight: 1 },
];

/**
 * Scan or type a barcode and see the product and unit it belongs to (SPEC §5.2): the check for
 * scanners and the camera before receiving and counting use them. The scan box sits in its own
 * card, the latest result below it and the earlier scans in a list.
 */
export function BarcodeLookupPage() {
  const { t } = useTranslation();
  const lookup = useBarcodeLookup();
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const remember = (entry: Omit<ScanEntry, 'id'>) =>
    setScans((previous) =>
      [{ ...entry, id: (previous[0]?.id ?? 0) + 1 }, ...previous].slice(0, RECENT_SCANS),
    );
  const scan = (code: string) =>
    lookup.mutate(code, {
      onSuccess: (found) => remember({ code, found, problem: null }),
      onError: (error) => remember({ code, found: null, problem: problemFromError(error) }),
    });
  const [latest, ...older] = scans;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('scan.title')} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-link">
              <ScanBarcode aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t('scan.cardTitle')}</h2>
              <p className="text-[0.8125rem] text-muted-foreground">{t('scan.hint')}</p>
            </div>
          </div>
          <ScanBox onScan={scan} />
          {/* The last result stays in view while the next code is looked up. */}
          <p role="status" className="text-[0.8125rem] text-muted-foreground empty:hidden">
            {lookup.isPending ? t('common.loading') : null}
          </p>
        </CardContent>
      </Card>
      {latest ? <ScanResult entry={latest} /> : null}
      {older.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('scan.recent')}
          </h2>
          <ListCard>
            <ListTable columns={RECENT_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('scan.label')}</TableHead>
                  <TableHead>{t('catalog.products.columns.name')}</TableHead>
                  <TableHead>{t('scan.unit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {older.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono">{entry.code}</TableCell>
                    <TableCell className="whitespace-normal">
                      {entry.found ? (
                        <Link
                          to={`/catalog/products/${entry.found.product.id}`}
                          className="font-medium text-link underline-offset-4 hover:underline"
                        >
                          {entry.found.product.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {entry.problem?.code === 'NOT_FOUND'
                            ? t('scan.notFound', { code: entry.code })
                            : t(`errors.${entry.problem?.code ?? 'INTERNAL_ERROR'}`)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{entry.found?.unit.uomName ?? t('common.none')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ListTable>
          </ListCard>
        </section>
      ) : null}
    </div>
  );
}

function ScanResult({ entry }: { entry: ScanEntry }) {
  const { t } = useTranslation();
  if (!entry.found) {
    return entry.problem?.code === 'NOT_FOUND' ? (
      <Alert variant="destructive">
        <AlertDescription>{t('scan.notFound', { code: entry.code })}</AlertDescription>
      </Alert>
    ) : (
      <ProblemAlert problem={entry.problem} />
    );
  }
  const { product, unit, barcode } = entry.found;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 gap-4">
          {product.thumbUrl ? (
            <img
              src={product.thumbUrl}
              alt=""
              className="size-24 shrink-0 rounded-xl object-cover ring-1 ring-black/[0.06]"
            />
          ) : (
            <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-fill">
              <ImageOff aria-hidden className="size-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              to={`/catalog/products/${product.id}`}
              className="text-lg leading-snug font-semibold underline-offset-4 hover:underline"
            >
              {product.name}
            </Link>
            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span className="font-mono">{product.sku}</span>
              {productStage(product) === 'ACTIVE' ? null : <ProductStageBadge product={product} />}
            </div>
            <span className="text-sm">
              {unit.isBase
                ? unit.uomName
                : t('catalog.units.factorOf', {
                    unit: unit.uomName,
                    factor: unit.factorToBase,
                    base: product.baseUnit.uomName,
                  })}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[0.8125rem]">{barcode.code}</span>
              {barcode.isPrimary ? (
                <Badge variant="secondary">{t('catalog.units.primary')}</Badge>
              ) : null}
              {barcode.isInternal ? (
                <Badge variant="outline">{t('catalog.units.internal')}</Badge>
              ) : null}
            </div>
          </div>
        </div>
        <Button variant="secondary" className="self-start sm:self-center" asChild>
          <Link to={`/catalog/products/${product.id}`}>
            {t('scan.openProduct')}
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
