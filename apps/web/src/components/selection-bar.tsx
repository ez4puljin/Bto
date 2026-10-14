import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * The bar of a list with ticked rows (ADR-0049): how many are ticked, what can be done with them
 * and «Сонголтыг цуцлах». It floats at the foot of the screen while the list scrolls, so the
 * actions stay at hand; nothing shows while no row is ticked.
 */
export function SelectionBar(props: { count: number; onClear: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  if (props.count === 0) return null;
  return (
    <div
      role="region"
      aria-label={t('common.selection')}
      className="sticky bottom-4 z-20 mx-auto mt-3 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.06] print:hidden"
    >
      <span className="px-1 text-sm font-medium tabular-nums">
        {t('common.selected', { count: props.count })}
      </span>
      {props.children}
      <Button variant="ghost" size="sm" onClick={props.onClear}>
        {t('common.clearSelection')}
      </Button>
    </div>
  );
}
