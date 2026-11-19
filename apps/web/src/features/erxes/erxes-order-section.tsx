import { useTranslation } from 'react-i18next';
import { PanelSection } from '@/components/record-sheet';
import { type ErxesDealLine, useErxesOrderDeal } from './api';
import { type BtoLinePrice, ErxesDealView } from './erxes-deal-view';

/** What the section needs of the order beside it: its lines' units and Bto's prices. */
interface OrderLines {
  id: number;
  lines: {
    productUnitId: number;
    total: string | null;
    parts: { unitPrice: string }[];
  }[];
}

/**
 * The order panel's «Erxes» section (ADR-0218 #4): everything the deal held in erxes, with
 * erxes's price of each line beside Bto's. Draws nothing for an order made in Bto.
 */
export function ErxesOrderSection({ order }: { order: OrderLines }) {
  const { t } = useTranslation();
  const deal = useErxesOrderDeal(order.id).data?.deal;
  if (!deal) return null;
  const btoPrice = (line: ErxesDealLine): BtoLinePrice | null => {
    const found = order.lines.find((entry) => entry.productUnitId === line.unit?.productUnitId);
    if (!found) return null;
    return { unitPrice: found.parts[0]?.unitPrice ?? null, total: found.total };
  };
  return (
    <PanelSection title={t('erxes.section.title')}>
      <ErxesDealView deal={deal} btoPrice={btoPrice} />
    </PanelSection>
  );
}
