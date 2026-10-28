import type { Permission } from '@tugeel/shared/auth';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ATTENTION_TILES, type AttentionTile, type ModuleKey, navTrail } from '@/app/nav-items';
import { useFinanceAttention } from '@/features/finance/api';
import { usePosAttention } from '@/features/pos/api';
import { useInventoryAttention, usePricingAttention } from './api';

/**
 * «Анхаарах» (ADR-0047 #7): the work waiting for this person, one entry per count above zero, each
 * opening its list already filtered; `only` keeps the tiles of one module (its page, ADR-0114).
 * `settled` once every count it asked for has come back.
 */
function useAttention(permissions: readonly Permission[], only?: ModuleKey) {
  const tiles = ATTENTION_TILES.filter(
    (tile) =>
      permissions.includes(tile.permission) &&
      (only === undefined || navTrail(tile.to.split('?')[0]!)?.module.key === only),
  );
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
  // Every count it asked for has come back (a query it never asked for stays idle).
  const settled = [inventory, pricing, finance, pos].every(
    (query) => query.isSuccess || (query.isPending && query.fetchStatus === 'idle'),
  );
  return { shown, settled };
}

/**
 * The attention counts as tiles, as many in a row as the column holds (ADR-0066); a module's page
 * shows its own. Nothing shows while the counts load, after an error, or when nothing waits.
 */
export function AttentionTiles({
  permissions,
  only,
}: {
  permissions: readonly Permission[];
  only?: ModuleKey;
}) {
  const { t } = useTranslation();
  const { shown } = useAttention(permissions, only);
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="home-attention">
      <h2 id="home-attention" className="mb-2.5 text-[15px] font-semibold tracking-tight">
        {t('home.attention.title')}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {shown.map(({ tile, count, cap, to }) => {
          const text = countText(t, count, cap);
          const label = t(tile.label);
          return (
            <Link
              key={tile.count}
              to={to}
              aria-label={`${label}: ${text}`}
              className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] hover:shadow-popover active:scale-[0.98]"
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

/**
 * The home page's «Анхаарах» card body (ADR-0114): one row per waiting count, the count at the
 * end, or a calm line once every count says nothing waits (nothing while loading or after an
 * error).
 */
export function AttentionRows({ permissions }: { permissions: readonly Permission[] }) {
  const { t } = useTranslation();
  const { shown, settled } = useAttention(permissions);
  if (shown.length === 0) {
    return !settled ? null : (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('home.nothingWaiting')}
      </p>
    );
  }
  return (
    <ul>
      {shown.map(({ tile, count, cap, to }) => {
        const text = countText(t, count, cap);
        const label = t(tile.label);
        return (
          <li key={tile.count} className="border-b border-border/80 last:border-0">
            <Link
              to={to}
              aria-label={`${label}: ${text}`}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/70"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                <tile.icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 font-mono text-[13px] font-semibold">
                {text}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function countText(t: TFunction, count: number, cap: number) {
  return count >= cap ? t('home.attention.more', { count: cap - 1 }) : String(count);
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
