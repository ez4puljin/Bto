import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { int, intOrNull, rowsOf, textOrNull } from './report-sql';

export interface BookOption {
  id: number;
  code: string | null;
  name: string;
  parentId: number | null;
}

export interface BookOptions {
  warehouses: BookOption[];
  categories: BookOption[];
  customerCategories: BookOption[];
  users: BookOption[];
  brands: BookOption[];
  segments: BookOption[];
}

const option = (row: Record<string, unknown>): BookOption => ({
  id: int(row.id),
  code: textOrNull(row.code),
  name: textOrNull(row.name) ?? '',
  parentId: intOrNull(row.parent_id),
});

/**
 * What the prompts of the stock and sales reports offer (ADR-0133): the active warehouses, the
 * product categories, the customer groups, the active staff, the brands (main suppliers) and the
 * hand-picked product segments — read here so a report reader needs no right on the screens these
 * lists come from.
 */
@Injectable()
export class BookOptionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async options(): Promise<BookOptions> {
    const [warehouses, categories, customerCategories, users, brands, segments] = await Promise.all(
      [
        rowsOf(
          this.db,
          sql`SELECT id, code, name, NULL AS parent_id FROM public.warehouses
             WHERE status = 'ACTIVE' ORDER BY code`,
        ),
        rowsOf(
          this.db,
          sql`SELECT id, NULL AS code, name, parent_id FROM public.categories ORDER BY name`,
        ),
        rowsOf(
          this.db,
          sql`SELECT id, NULL AS code, name, NULL AS parent_id FROM public.customer_categories
             WHERE active ORDER BY sort_order, name`,
        ),
        rowsOf(
          this.db,
          sql`SELECT id, username AS code, full_name AS name, NULL AS parent_id FROM public.users
             WHERE status = 'ACTIVE' ORDER BY full_name`,
        ),
        rowsOf(
          this.db,
          sql`SELECT s.id, s.code, s.name, NULL AS parent_id FROM public.suppliers s
             WHERE EXISTS (SELECT 1 FROM public.product_suppliers ps
                            WHERE ps.supplier_id = s.id AND ps.is_main)
             ORDER BY s.name`,
        ),
        rowsOf(
          this.db,
          sql`SELECT id, NULL AS code, name, NULL AS parent_id FROM public.segments
             WHERE entity = 'PRODUCT' AND kind = 'LIST' AND archived_at IS NULL ORDER BY name`,
        ),
      ],
    );
    return {
      warehouses: warehouses.map(option),
      categories: categories.map(option),
      customerCategories: customerCategories.map(option),
      users: users.map(option),
      brands: brands.map(option),
      segments: segments.map(option),
    };
  }
}
