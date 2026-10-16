import type { Permission } from '@tugeel/shared/auth';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ATTENTION_TILES, type AttentionTile } from '@/app/nav-items';
import { useFinanceAttention } from '@/features/finance/api';
import { usePosAttention } from '@/features/pos/api';
import { useInventoryAttention, usePricingAttention } from './api';

/**
 * «Анхаарах» (ADR-0047 #7): the work waiting for this person, one tile per count above zero, each
 * opening its list already filtered. Nothing shows while the counts load, after an error, or when
 * nothing waits.
 */
export function AttentionTiles({ permissions }: { permissions: readonly Permission[] }) {
  const { t } = useTranslation();
  const tiles = ATTENTION_TILES.filter((tile) => permissions.includes(tile.permission));
  const inventory = useInventoryAttention(
    tiles.some(
      (tile) =>
        tile.count !== 'productsWaitingForPrices' &&
        tile.count !== 'overdueReceivables' &&
        tile.count !== 'shiftsToHandOver',
    ),
  );
  const pricing = usePricingAttention(
    tiles.some((tile) => tile.count === 'productsWaitingForPrices'),
  );
  const finance = useFinanceAttention(tiles.some((tile) => tile.count === 'overdueReceivables'));
  const pos = usePosAttention(tiles.some((tile) => tile.count === 'shiftsToHandOver'));

  const shown = tiles.flatMap((tile) => {
    const counted = countOf(tile, inventory.data, pricing.data, finance.data, pos.data);
    return counted && counted.count > 0 ? [{ tile, ...counted }] : [];
  });
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="home-attention">
      <h2 id="home-attention" className="mb-2.5 text-[15px] font-semibold tracking-tight">
        {t('home.attention.title')}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {shown.map(({ tile, count, cap, to }) => {
          const text = count >= cap ? t('home.attention.more', { count: cap - 1 }) : String(count);
          const label = t(tile.label);
          return (
            <Link
              key={tile.count}
              to={to}
              aria-label={`${label}: ${text}`}
              className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] hover:shadow-popover active:scale-[0.98]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                <tile.icon aria-hidden className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-xl leading-none font-semibold">{text}</span>
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">
                  {label}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** A tile's count, its cap and where it leads; null while its endpoint has no answer. */
function countOf(
  tile: AttentionTile,
  inventory: ReturnType<typeof useInventoryAttention>['data'],
  pricing: ReturnType<typeof usePricingAttention>['data'],
  finance: ReturnType<typeof useFinanceAttention>['data'],
  pos: ReturnType<typeof usePosAttention>['data'],
): { count: number; cap: number; to: string } | null {
  if (tile.count === 'shiftsToHandOver') {
    return pos ? { count: pos.shiftsToHandOver, cap: 1000, to: tile.to } : null;
  }
  if (tile.count === 'overdueReceivables') {
    // Customers, not invoices: the list opens on them (ADR-0060 #11); no cap on the server.
    return finance ? { count: finance.overdueCustomers, cap: 1000, to: tile.to } : null;
  }
  if (tile.count === 'productsWaitingForPrices') {
    return pricing
      ? { count: pricing.productsWaitingForPrices, cap: pricing.cap, to: tile.to }
      : null;
  }
  if (!inventory) return null;
  if (tile.count === 'lowStock') {
    const { count, warehouseId } = inventory.lowStock;
    return {
      count,
      cap: inventory.cap,
      to: warehouseId === null ? tile.to : `${tile.to}?warehouseId=${warehouseId}`,
    };
  }
  return { count: inventory[tile.count], cap: inventory.cap, to: tile.to };
}
