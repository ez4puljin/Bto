import type { ProblemDetails } from '@tugeel/api-client';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { type BarcodeResolution, useBarcodeLookup } from './api';

interface ScanEntry {
  id: number;
  code: string;
  found: BarcodeResolution | null;
  problem: ProblemDetails | null;
}

const RECENT_SCANS = 10;

/**
 * Scan or type a barcode and see the product and unit it belongs to (SPEC §5.2): the check for
 * scanners and the camera before receiving and counting use them.
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
    <div className="flex flex-col gap-4">
      <PageHeader title={t('scan.title')} />
      <p className="-mt-2 text-sm text-muted-foreground">{t('scan.hint')}</p>
      <ScanBox onScan={scan} />
      {lookup.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : null}
      {latest && !lookup.isPending ? <ScanResult entry={latest} /> : null}
      {older.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">{t('scan.recent')}</h2>
          <Table>
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
                        className="underline-offset-4 hover:underline"
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
          </Table>
        </div>
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
      <CardContent className="flex gap-4">
        {product.thumbUrl ? (
          <img src={product.thumbUrl} alt="" className="size-24 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted">
            <ImageOff className="size-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={`/catalog/products/${product.id}`}
            className="text-lg font-medium underline-offset-4 hover:underline"
          >
            {product.name}
          </Link>
          <span className="font-mono text-sm text-muted-foreground">{product.sku}</span>
          <span>
            {unit.isBase
              ? unit.uomName
              : t('catalog.units.factorOf', {
                  unit: unit.uomName,
                  factor: unit.factorToBase,
                  base: product.baseUnit.uomName,
                })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{barcode.code}</span>
            {barcode.isPrimary ? (
              <Badge variant="secondary">{t('catalog.units.primary')}</Badge>
            ) : null}
            {barcode.isInternal ? (
              <Badge variant="outline">{t('catalog.units.internal')}</Badge>
            ) : null}
            {product.status === 'INACTIVE' ? (
              <Badge variant="outline">{t('catalog.products.status.INACTIVE')}</Badge>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
