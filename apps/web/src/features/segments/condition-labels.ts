import type mn from '@tugeel/shared/i18n/mn.json';
import type { SegmentEntity } from '@tugeel/shared/segments';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useCategories } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { useWarehouses } from '@/features/identity/api';
import { useSuppliersByIds } from '@/features/partners/api';
import { usePriceProfileChoices } from '@/features/pricing/api';

type Fields = (typeof mn)['segments']['fields'];
type FieldKey = {
  [E in SegmentEntity]: `segments.fields.${E}.${keyof Fields[E] & string}`;
}[SegmentEntity];

export const NO_IDS: readonly number[] = [];
/** Warehouses that sell: the ones homes, stock and minimums are kept for. */
export const SELLING_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];

export const fieldLabel = (t: TFunction, entity: SegmentEntity, field: string) =>
  t(`segments.fields.${entity}.${field}` as FieldKey);

/** A value of a `values` field in words (a stage, a missing piece, a customer kind, a status). */
export function valueLabel(t: TFunction, field: string, value: string): string {
  switch (field) {
    case 'stage':
      return t(`catalog.products.status.${value as 'ACTIVE' | 'PENDING' | 'INACTIVE'}`);
    case 'missing':
      return t(
        `segments.missing.${value as 'BASE_BARCODE' | 'ANY_BARCODE' | 'PHOTO' | 'WEIGHT' | 'EBARIMT'}`,
      );
    case 'kind':
      return t(`partners.kinds.${value as 'COMPANY' | 'INDIVIDUAL'}`);
    case 'status':
      return t(`partners.status.${value as 'ACTIVE' | 'INACTIVE'}`);
    default:
      return value;
  }
}

/** Names of the ids a condition names (categories by path), or null while they load. */
export function useIdNames(field: string, ids: readonly number[]): string[] | null {
  const categories = useCategories();
  const warehouses = useWarehouses();
  const suppliers = useSuppliersByIds(field === 'supplier' ? ids : NO_IDS);
  const profiles = usePriceProfileChoices();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const named = (rows: readonly { id: number; name: string }[] | undefined) => {
    if (!rows) return null;
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return ids.map((id) => names.get(id) ?? `#${id}`);
  };
  switch (field) {
    case 'category':
      return categories.data ? ids.map((id) => paths.get(id) ?? `#${id}`) : null;
    case 'supplier':
      return ids.length === 0 ? [] : named(suppliers.data);
    case 'homeWarehouse':
    case 'stock':
      return named(warehouses.data);
    case 'priceProfile':
      return named(profiles.data);
    default:
      return ids.map(String);
  }
}
