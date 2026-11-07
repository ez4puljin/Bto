import { AI_DATA_GROUPS, aiDataPermission, type AiDataGroup } from '@tugeel/shared/ai';
import type { Permission } from '@tugeel/shared/auth';

/**
 * Which views each data group opens (ADR-0162). The groups go by view, not by column: a view shows
 * every column to whoever holds its group, so `ai.sales_orders` shows the customer's name without
 * `customers`. A view of a new module joins a group here; a test fails on a view left out.
 */
export const AI_GROUP_VIEWS: Readonly<Record<AiDataGroup, readonly string[]>> = {
  catalog: ['categories', 'products', 'product_units'],
  stock: [
    'warehouses',
    'stock',
    'low_stock',
    'stock_movements',
    'stock_documents',
    'receipt_lines',
    'expiry_items',
  ],
  customers: ['customers', 'customer_addresses'],
  suppliers: ['suppliers', 'product_suppliers'],
  pricing: ['price_profiles', 'product_prices_today', 'product_price_history', 'discount_programs'],
  sales: ['sales_orders', 'sales_order_lines'],
  finance: ['invoices', 'invoice_lines', 'payments', 'customer_balances'],
};

/** The views a person's queries may read. */
export type AiAccess = ReadonlySet<string>;

/** Every view: what an ADMIN holds, and what a test of the guard's other rules runs with. */
export const ALL_VIEWS: AiAccess = new Set(Object.values(AI_GROUP_VIEWS).flat());

/** The views the holder's `ai.data.*` permissions open. */
export function accessOf(permissions: ReadonlySet<Permission>): AiAccess {
  return new Set(
    AI_DATA_GROUPS.filter((group) => permissions.has(aiDataPermission(group))).flatMap(
      (group) => AI_GROUP_VIEWS[group],
    ),
  );
}
