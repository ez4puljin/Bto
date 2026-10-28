import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  POS_LIMITS,
  type PosStatus,
  type SnapshotPaymentType,
  type TenderKind,
} from '@tugeel/shared/pos';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext } from '../../identity';
import { posPaymentTypes } from '../schema';

export interface PaymentType {
  id: number;
  name: string;
  kind: TenderKind;
  status: PosStatus;
  sort: number;
}

export interface PaymentTypesInput {
  /** The whole list in the till's order: a row with an id keeps it, one without adds a type. */
  types: { id: number | null; name: string; kind: TenderKind; status: PosStatus }[];
}

/**
 * The ways to pay the admin offers at the till (ADR-0111): cash, a bank's card terminal, a bank
 * transfer, credit — named by the admin and listed in its order, carried to the edge in the
 * snapshot. Saved as a whole list; a type is never deleted (tenders name it) but made INACTIVE,
 * and a type keeps its kind once made. At most one active CASH and one active CREDIT type; one
 * active CASH type is needed (returns pay back in cash).
 */
/** The owner's first types (2026-10-27), as migration 0050 seeds them for an existing database. */
const FIRST_TYPES: readonly { name: string; kind: TenderKind }[] = [
  { name: 'Бэлэн', kind: 'CASH' },
  { name: 'Khaanbank terminal', kind: 'CARD' },
  { name: 'Шилжүүлэг', kind: 'TRANSFER' },
  { name: 'Зээл', kind: 'CREDIT' },
];

@Injectable()
export class PosPaymentTypesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** An empty list (a new database) gets the first types at boot, like the other seeds. */
  async onApplicationBootstrap(): Promise<void> {
    const [any] = await this.db.select({ id: posPaymentTypes.id }).from(posPaymentTypes).limit(1);
    if (any) return;
    await this.db
      .insert(posPaymentTypes)
      .values(FIRST_TYPES.map((type, sort) => ({ ...type, sort })))
      .onConflictDoNothing();
  }

  async list(executor: Db | Tx = this.db): Promise<PaymentType[]> {
    return executor
      .select({
        id: posPaymentTypes.id,
        name: posPaymentTypes.name,
        kind: posPaymentTypes.kind,
        status: posPaymentTypes.status,
        sort: posPaymentTypes.sort,
      })
      .from(posPaymentTypes)
      .orderBy(asc(posPaymentTypes.sort), asc(posPaymentTypes.id));
  }

  async forSnapshot(executor: Db | Tx = this.db): Promise<SnapshotPaymentType[]> {
    return (await this.list(executor))
      .filter((type) => type.status === 'ACTIVE')
      .map((type) => ({ id: type.id, name: type.name, kind: type.kind }));
  }

  /** The types of these ids, for the tenders a replayed sale names. */
  async byIds(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, PaymentType>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({
        id: posPaymentTypes.id,
        name: posPaymentTypes.name,
        kind: posPaymentTypes.kind,
        status: posPaymentTypes.status,
        sort: posPaymentTypes.sort,
      })
      .from(posPaymentTypes)
      .where(inArray(posPaymentTypes.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async replace(ctx: AuthContext, input: PaymentTypesInput): Promise<PaymentType[]> {
    if (input.types.length === 0 || input.types.length > POS_LIMITS.maxPaymentTypes) {
      throw invalid('types', 'count', `1 to ${POS_LIMITS.maxPaymentTypes} payment types`);
    }
    const names = new Set<string>();
    const ids = new Set<number>();
    const activeOf = (kind: TenderKind) =>
      input.types.filter((type) => type.kind === kind && type.status === 'ACTIVE').length;
    input.types.forEach((type, index) => {
      const name = type.name.trim();
      if (name.length === 0 || name.length > POS_LIMITS.maxPaymentTypeName) {
        throw invalid(`types[${index}].name`, 'length', `1 to ${POS_LIMITS.maxPaymentTypeName}`);
      }
      const key = name.toLocaleLowerCase('mn');
      if (names.has(key)) throw invalid(`types[${index}].name`, 'unique', 'named once');
      names.add(key);
      if (type.id !== null) {
        if (ids.has(type.id)) throw invalid(`types[${index}].id`, 'unique', 'listed once');
        ids.add(type.id);
      }
    });
    if (activeOf('CASH') !== 1) throw invalid('types', 'cash', 'exactly one active cash type');
    if (activeOf('CREDIT') > 1) throw invalid('types', 'credit', 'at most one active credit type');
    await inTransaction(this.db, async (tx) => {
      const before = await this.list(tx);
      const known = new Map(before.map((type) => [type.id, type]));
      for (const type of input.types) {
        if (type.id === null) continue;
        const was = known.get(type.id);
        if (!was) throw notFound('pos_payment_type', type.id);
        if (was.kind !== type.kind) {
          throw invalid('types', 'kind', `«${was.name}» keeps its kind ${was.kind}`);
        }
      }
      // Out of the way first: the names and the active kinds are unique.
      await tx.update(posPaymentTypes).set({
        status: 'INACTIVE',
        name: sql`'~' || ${posPaymentTypes.id}::text`,
        sort: sql`${posPaymentTypes.sort} + 1000`,
      });
      let sort = 0;
      for (const type of input.types) {
        const values = {
          name: type.name.trim(),
          kind: type.kind,
          status: type.status,
          sort: sort++,
          updatedAt: sql`now()`,
        };
        if (type.id === null) await tx.insert(posPaymentTypes).values(values);
        else await tx.update(posPaymentTypes).set(values).where(eq(posPaymentTypes.id, type.id));
      }
      // Types left out of the list stay, inactive, with their names back (marked when a listed
      // type took the name).
      for (const type of before) {
        if (ids.has(type.id)) continue;
        const name = names.has(type.name.toLocaleLowerCase('mn'))
          ? `${type.name.slice(0, POS_LIMITS.maxPaymentTypeName - 12)} (#${type.id})`
          : type.name;
        await tx
          .update(posPaymentTypes)
          .set({ name, status: 'INACTIVE', sort: sort++ })
          .where(eq(posPaymentTypes.id, type.id));
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_payment_types',
        entityId: 0,
        before: { types: before.map(({ id, name, kind, status }) => ({ id, name, kind, status })) },
        after: { types: input.types },
      });
    });
    return this.list();
  }
}
