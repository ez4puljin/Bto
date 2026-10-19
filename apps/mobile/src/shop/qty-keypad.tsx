import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepProduct } from '../api/rep';
import { formatMnt, formatQty } from '../format/format';
import { KeypadSheet } from './keypad-sheet';
import { useUnitWords } from './unit-words';
import { baseQty, baseUnitOf, shortBy } from './units';
import { useLineQuote } from './use-line-quote';

/**
 * The rep's «Тоо оруулах» (the ProductKeypad board, ADR-0068): the product with its code and stock,
 * the unit switch, the number with what it comes to (pieces and the server's total), the shortage,
 * and the keypad. «Болсон» hands the unit and the number back; «Цуцлах» and the back button drop
 * them.
 */
export function QtyKeypad({
  visible,
  product,
  server,
  unitId,
  qty,
  onDone,
  onCancel,
}: {
  visible: boolean;
  product: RepProduct;
  server: string;
  unitId: number;
  qty: number;
  onDone: (unitId: number, qty: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const [unit, setUnit] = useState(unitId);
  const [digits, setDigits] = useState(String(qty));
  useEffect(() => {
    if (!visible) return;
    setUnit(unitId);
    setDigits(qty > 0 ? String(qty) : '');
  }, [visible, unitId, qty]);

  const value = digits === '' ? 0 : Number.parseInt(digits, 10);
  const chosen = product.units.find((entry) => entry.id === unit) ?? product.units[0];
  const base = baseUnitOf(product.units);
  const quote = useLineQuote(product.units, chosen?.id ?? null, value);
  if (!chosen || !base) return null;
  const pieces = baseQty(value, chosen);
  const short = shortBy(pieces, product.available);
  const conversion = [
    chosen.isBase
      ? null
      : t('mobile.product.equals', { n: pieces.toFixed(), unit: words(base).name }),
    quote.total ? t('mobile.product.totalIs', { amount: formatMnt(quote.total) }) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <KeypadSheet
      visible={visible}
      product={product}
      server={server}
      subtitle={t('mobile.keypad.codeStock', {
        sku: product.sku,
        n: formatQty(product.available),
        unit: words(base).name,
      })}
      unit={chosen}
      digits={digits}
      onUnit={setUnit}
      onDigits={setDigits}
      conversion={conversion}
      note={
        short.gt(0)
          ? t('mobile.keypad.short', {
              stock: formatQty(product.available),
              short: short.toFixed(),
              unit: words(base).name,
            })
          : null
      }
      onDone={() => onDone(unit, value)}
      onCancel={onCancel}
    />
  );
}
