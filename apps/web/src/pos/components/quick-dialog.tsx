import type { EdgeProductHit } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatTugrik } from '@/lib/money';
import { keepFocus } from '../keys';
import { useProblemText } from '../messages';
import { useQuickButtons } from '../queries';
import { KioskAlert } from './layout';

/**
 * «Хурдан товч (F7)» (ADR-0104): the admin's groups as tabs and their products as large buttons,
 * for goods without a barcode (bread, loose goods, bags); a press adds one and the dialog stays
 * open for the next.
 */
export function QuickDialog(props: {
  open: boolean;
  onClose: () => void;
  onPick: (product: EdgeProductHit, unitId: number) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="xl" className="gap-3" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.quick.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.quick.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <QuickPanel onPick={props.onPick} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function QuickPanel({ onPick }: { onPick: (product: EdgeProductHit, unitId: number) => void }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const groups = useQuickButtons(true);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  if (groups.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (groups.isError) return <KioskAlert>{problemText(groups.error)}</KioskAlert>;
  if (groups.data.length === 0) {
    return <KioskAlert tone="info">{t('posKiosk.quick.empty')}</KioskAlert>;
  }
  const group = groups.data.find((entry) => entry.id === groupId) ?? groups.data[0];
  return (
    <div className="space-y-3">
      {groups.data.length > 1 ? (
        <div role="tablist" className="flex flex-wrap gap-2">
          {groups.data.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === group?.id}
              className={cn(
                'h-11 rounded-full px-4 text-[0.9375rem] font-medium ring-1 ring-border transition-colors',
                entry.id === group?.id
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background hover:bg-accent',
              )}
              onMouseDown={keepFocus}
              onClick={() => setGroupId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
      <div
        role="tabpanel"
        className="grid max-h-[min(30rem,60svh)] grid-cols-3 gap-2 overflow-y-auto lg:grid-cols-4"
      >
        {group?.buttons.map((button) => {
          const unit = button.product.units.find((entry) => entry.unitId === button.unitId);
          const name = button.label ?? button.product.name;
          const priced = unit?.price !== null && unit?.price !== undefined;
          return (
            <button
              key={`${group.id}:${button.unitId}`}
              type="button"
              disabled={!priced}
              aria-label={t('posKiosk.quick.add', { name })}
              className="flex h-24 flex-col justify-between rounded-xl bg-card p-3 text-left shadow-card ring-1 ring-black/[0.06] transition-colors hover:bg-accent active:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              onMouseDown={keepFocus}
              onClick={() => {
                onPick(button.product, button.unitId);
                setAdded(name);
              }}
            >
              <span className="line-clamp-2 text-[0.9375rem] leading-snug font-medium">{name}</span>
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground">{unit?.uomName}</span>
                <span className="font-mono font-semibold">
                  {priced ? formatTugrik(unit.price ?? '0') : t('posKiosk.sale.unpriced')}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" className="min-h-5 text-sm text-success">
        {added ? t('posKiosk.quick.added', { name: added }) : null}
      </p>
    </div>
  );
}
