import { sql } from 'drizzle-orm';
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { AnyTx } from './any-tx';

/** A table of gap-free counters: one row per key, `value` the last number given out. */
export interface CounterTable<T extends PgTable> {
  table: T;
  /** The columns of the primary key (or unique index) the upsert conflicts on. */
  key: [PgColumn, ...PgColumn[]];
  /** The last value, a bigint in `mode: 'number'`, and its property name on the table. */
  value: PgColumn;
  valueProperty: keyof T['$inferInsert'] & string;
}

/**
 * The next gap-free number of a counter row (ADR-0002 #7, SPEC §6.13), for any owner's counter table
 * (identity's `number_sequences`, later the Finance Core's `fin.number_counters`). Call it inside the
 * posting transaction under READ COMMITTED: the upsert locks the row until commit, so concurrent
 * callers queue and a rollback gives the number back. `key` holds the row's key values.
 */
export async function nextCounterValue<T extends PgTable>(
  tx: AnyTx,
  counter: CounterTable<T>,
  key: Partial<T['$inferInsert']>,
): Promise<number> {
  const rows = await tx
    .insert(counter.table)
    .values({ ...key, [counter.valueProperty]: 1 } as PgInsertValue<T>)
    .onConflictDoUpdate({
      target: counter.key,
      set: { [counter.valueProperty]: sql`${counter.value} + 1` } as PgUpdateSetSource<T>,
    })
    .returning({ value: counter.value });
  const value: unknown = rows[0]?.value;
  if (typeof value !== 'number') {
    throw new Error(`counter ${JSON.stringify(key)} returned no number`);
  }
  return value;
}
