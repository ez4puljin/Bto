import { cleanBarcode } from '@tugeel/shared/gtin';
import type { EdgeProductHit } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { ScanBarcode } from 'lucide-react';
import { useState } from 'react';
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
import { formatQty, formatTugrik } from '@/lib/money';
import { useDebounced } from '@/lib/use-debounced';
import { edgeProblemOf } from '../edge-client';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { useProductSearch } from '../queries';
import { KioskAlert } from './layout';

/** A barcode scanned into the field: digits only, at least an EAN-8. */
const BARCODE_LIKE = /^\d{8,14}$/;

/**
 * «Үнэ шалгах (F8)» (ADR-0104): a customer asks what something costs — scan it or find it by name
 * and see every unit's price, code and barcodes. Nothing goes into the cart.
 */
export function PriceCheckDialog(props: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" className="gap-3" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.priceCheck.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.priceCheck.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <PriceCheckPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PriceCheckPanel() {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [text, setText] = useState('');
  const [shown, setShown] = useState<EdgeProductHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(shown ? '' : text.trim(), 250);
  const search = useProductSearch(q);
  const hits = q.length > 0 ? (search.data ?? []) : [];

  const lookUp = async (typed: string) => {
    const code = cleanBarcode(typed);
    setError(null);
    try {
      const hit = await client.barcode(code);
      setShown(hit.product);
      setText('');
    } catch (caught) {
      setError(
        edgeProblemOf(caught).code === 'NOT_FOUND'
          ? t('scan.notFound', { code })
          : problemText(caught),
      );
      setText('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <ScanBarcode
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          aria-label={t('posKiosk.search.label')}
          placeholder={t('posKiosk.search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          className="h-12 pl-10 text-lg md:text-lg"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setShown(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const typed = text.trim();
            if (BARCODE_LIKE.test(cleanBarcode(typed))) void lookUp(typed);
            else if (hits[0]) setShown(hits[0]);
          }}
        />
      </div>
      {error ? <KioskAlert>{error}</KioskAlert> : null}
      {search.isError ? <KioskAlert>{problemText(search.error)}</KioskAlert> : null}
      {shown ? (
        <ProductPrices product={shown} />
      ) : (
        <ul
          aria-label={t('posKiosk.search.results')}
          className="max-h-[min(24rem,50svh)] space-y-1 overflow-y-auto"
        >
          {hits.map((product) => (
            <li key={product.productId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent"
                onClick={() => setShown(product)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-medium">
                    {product.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.sku}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[0.9375rem] font-semibold">
                  {product.units[0]?.price
                    ? formatTugrik(product.units[0].price)
                    : t('posKiosk.sale.unpriced')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => {
            setShown(null);
            setText('');
          }}
        >
          {t('posKiosk.priceCheck.another')}
        </Button>
      ) : null}
    </div>
  );
}

function ProductPrices({ product }: { product: EdgeProductHit }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={product.name}
      className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-border"
    >
      <header>
        <h2 className="text-lg leading-snug font-semibold">{product.name}</h2>
        <p className="text-sm text-muted-foreground">
          {t('posKiosk.priceCheck.sku', { sku: product.sku })}
        </p>
      </header>
      <table className="w-full text-[0.9375rem]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">{t('posKiosk.priceCheck.unit')}</th>
            <th className="py-1 font-medium">{t('posKiosk.priceCheck.barcodes')}</th>
            <th className="py-1 text-right font-medium">{t('posKiosk.priceCheck.price')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {product.units.map((unit) => (
            <tr key={unit.unitId}>
              <td className="py-2 pr-3 align-top">
                {unit.isBase
                  ? unit.uomName
                  : t('posKiosk.search.unitFactor', {
                      uom: unit.uomName,
                      factor: formatQty(unit.factor),
                    })}
              </td>
              <td className="py-2 pr-3 align-top font-mono text-sm">
                {unit.barcodes.length ? (
                  unit.barcodes.map((code) => (
                    <span key={code} className="block">
                      {code}
                    </span>
                  ))
                ) : (
                  <span className="font-sans text-muted-foreground">
                    {t('posKiosk.priceCheck.noBarcode')}
                  </span>
                )}
              </td>
              <td
                className={cn(
                  'py-2 text-right align-top font-mono text-xl font-semibold',
                  unit.price === null ? 'font-sans text-base text-warning' : null,
                )}
              >
                {unit.price === null ? t('posKiosk.sale.unpriced') : formatTugrik(unit.price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
