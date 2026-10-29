import { Decimal } from '@tugeel/shared/money';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeypadSheet, type KeypadUnit } from '../shop/keypad-sheet';
import { useUnitWords } from '../shop/unit-words';
import { baseQty, baseUnitOf } from '../shop/units';
import type { TransferLine, TransferRequestRowUnit } from './types';

/** What the transfer keypad types a number for: a product with its units, no price. */
export interface KeypadTarget {
  name: string;
  sku: string;
  thumbUrl: string | null;
  units: readonly KeypadUnit[];
}

/** A request row's units as the keypad takes them (no wholesale price: a transfer has none). */
export function keypadUnitsOfRow(units: readonly TransferRequestRowUnit[]): KeypadUnit[] {
  return units.map((unit) => ({
    id: unit.id,
    uomName: unit.name,
    uomCode: unit.uomCode,
    factorToBase: unit.factor,
    isBase: unit.isBase,
    wholesale: null,
  }));
}

/**
 * A shipped line's units for the count: the unit asked for and the base unit (one when they are
 * the same), plus the scanned unit when it is another one of the product's.
 */
export function keypadUnitsOfLine(
  line: Pick<
    TransferLine,
    'requestUnitId' | 'unitName' | 'requestFactor' | 'baseUnitId' | 'baseUnitName'
  >,
  scanned: { id: number; uomName: string; factorToBase: string; isBase: boolean } | null,
): KeypadUnit[] {
  const base: KeypadUnit = {
    id: line.baseUnitId,
    uomName: line.baseUnitName,
    factorToBase: '1',
    isBase: true,
    wholesale: null,
  };
  const units: KeypadUnit[] = [base];
  if (line.requestUnitId !== line.baseUnitId) {
    units.push({
      id: line.requestUnitId,
      uomName: line.unitName,
      factorToBase: line.requestFactor,
      isBase: new Decimal(line.requestFactor).eq(1),
      wholesale: null,
    });
  }
  if (scanned && !units.some((unit) => unit.id === scanned.id)) {
    units.push({
      id: scanned.id,
      uomName: scanned.uomName,
      factorToBase: scanned.factorToBase,
      isBase: scanned.isBase,
      wholesale: null,
    });
  }
  return units;
}

/**
 * «Тоо оруулах» for a transfer (ADR-0116; a sibling of src/shop/qty-keypad.tsx): the unit switch
 * when the product has several units, the number with what it comes to in pieces, no price and no
 * quote; `extra` is «Ирээгүй» when receiving. «Болсон» hands the unit and the number back as a
 * quantity string; «Цуцлах» and the back button drop them.
 */
export function TransferKeypad({
  visible,
  target,
  server,
  unitId,
  qty,
  subtitle,
  note = null,
  extra,
  onDone,
  onCancel,
}: {
  visible: boolean;
  target: KeypadTarget;
  server: string;
  unitId: number;
  /** The quantity the keypad opens with, in that unit; '' or '0' for none. */
  qty: string;
  /** Under the name: the code and the stock, or what was shipped. */
  subtitle: string | ((unit: KeypadUnit) => string);
  note?: string | null;
  extra?: { label: string; onPress: () => void };
  onDone: (unitId: number, qty: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const [unit, setUnit] = useState(unitId);
  const [digits, setDigits] = useState('');
  useEffect(() => {
    if (!visible) return;
    setUnit(unitId);
    setDigits(qty && new Decimal(qty).gt(0) ? new Decimal(qty).toFixed() : '');
  }, [visible, unitId, qty]);

  const chosen = target.units.find((entry) => entry.id === unit) ?? target.units[0];
  const base = baseUnitOf(target.units);
  if (!chosen || !base) return null;
  const value = digits === '' ? 0 : Number.parseInt(digits, 10);
  const conversion = chosen.isBase
    ? ''
    : t('mobile.product.equals', {
        n: baseQty(value, chosen).toFixed(),
        unit: words(base).name,
      });

  return (
    <KeypadSheet
      visible={visible}
      product={target}
      server={server}
      subtitle={typeof subtitle === 'string' ? subtitle : subtitle(chosen)}
      unit={chosen}
      digits={digits}
      onUnit={setUnit}
      onDigits={setDigits}
      conversion={conversion}
      note={note}
      {...(extra ? { extra } : {})}
      onDone={() => onDone(chosen.id, String(value))}
      onCancel={onCancel}
    />
  );
}
