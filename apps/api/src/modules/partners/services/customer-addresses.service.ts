import { Inject, Injectable } from '@nestjs/common';
import { isInMongolia } from '@tugeel/shared/geo';
import type { Decimal } from '@tugeel/shared/money';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { customerAddresses, customers, type GPS_SOURCES } from '../schema';
import { optionalText } from './support';

type AddressRow = typeof customerAddresses.$inferSelect;
export type GpsSource = (typeof GPS_SOURCES)[number];

export interface AddressInput {
  label?: string | null;
  address?: string | null;
  /** Both or neither, inside Mongolia (@tugeel/shared/geo). */
  lat?: Decimal | null;
  lng?: Decimal | null;
  note?: string | null;
}

/** What an order stores of its delivery address (delivery 2): the id plus a copy of the place. */
export interface AddressSnapshot {
  id: number;
  label: string | null;
  address: string | null;
  lat: Decimal | null;
  lng: Decimal | null;
  zoneId: number | null;
  note: string | null;
}

/**
 * Delivery addresses of customers: one default per customer, archived instead of deleted (orders
 * will reference them). Every change locks the customer row (FOR NO KEY UPDATE), so two default
 * changes of one customer never race.
 */
@Injectable()
export class CustomerAddressesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Active addresses, the default first; archived ones too with `withArchived`. */
  async ofCustomer(
    customerId: number,
    executor: Db | Tx = this.db,
    withArchived = false,
  ): Promise<AddressRow[]> {
    return executor
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.customerId, customerId),
          withArchived ? undefined : isNull(customerAddresses.archivedAt),
        ),
      )
      .orderBy(desc(customerAddresses.isDefault), asc(customerAddresses.id));
  }

  /** The default address of a customer, or null when it has none. */
  async defaultAddress(
    customerId: number,
    executor: Db | Tx = this.db,
  ): Promise<AddressSnapshot | null> {
    const [row] = await executor
      .select()
      .from(customerAddresses)
      .where(
        and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.isDefault, true)),
      );
    return row ? snapshot(row) : null;
  }

  add(
    actor: Actor,
    customerId: number,
    input: AddressInput,
    isDefault = false,
  ): Promise<AddressRow> {
    return inTransaction(this.db, (tx) =>
      this.addInTx(tx, actor, customerId, input, { isDefault }),
    );
  }

  /** Adds an address; the first active one becomes the default whatever `isDefault` says. */
  async addInTx(
    tx: Tx,
    actor: Actor,
    customerId: number,
    input: AddressInput,
    options: { isDefault?: boolean; gpsSource?: GpsSource } = {},
  ): Promise<AddressRow> {
    const place = validated(input);
    await lockCustomer(tx, customerId);
    const current = await this.currentDefault(tx, customerId);
    const isDefault = options.isDefault === true || current === undefined;
    if (isDefault && current) await this.clearDefault(tx, current.id);
    const [row] = await tx
      .insert(customerAddresses)
      .values({
        customerId,
        label: place.label,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        gpsSource: place.lat ? (options.gpsSource ?? 'OFFICE') : null,
        note: place.note,
        isDefault,
      })
      .returning();
    if (!row) throw new Error('address insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'customer_addresses',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  /** Edits an active address from the office; GPS points written here come from a map. */
  update(actor: Actor, id: number, input: AddressInput): Promise<AddressRow> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockActive(tx, id);
      const place = validated({
        label: input.label === undefined ? before.label : input.label,
        address: input.address === undefined ? before.address : input.address,
        lat: input.lat === undefined ? before.lat : input.lat,
        lng: input.lng === undefined ? before.lng : input.lng,
        note: input.note === undefined ? before.note : input.note,
      });
      const moved =
        !sameCoordinate(place.lat, before.lat) || !sameCoordinate(place.lng, before.lng);
      return this.write(tx, actor, before, {
        ...place,
        ...(moved ? { gpsSource: place.lat ? ('OFFICE' as const) : null } : {}),
      });
    });
  }

  /**
   * A GPS point captured on site by a driver or a sales rep (delivery 4–5); callers check their own
   * permission. Only the point and its source change.
   */
  async setLocationInTx(
    tx: Tx,
    actor: Actor,
    id: number,
    point: { lat: Decimal; lng: Decimal; source: GpsSource },
  ): Promise<AddressRow> {
    const before = await this.lockActive(tx, id);
    if (!isInMongolia(point.lat, point.lng))
      throw invalid('lat', 'mongolia', 'GPS outside Mongolia');
    return this.write(tx, actor, before, {
      lat: point.lat,
      lng: point.lng,
      gpsSource: point.source,
    });
  }

  /** Makes an active address the default one of its customer. */
  setDefault(actor: Actor, id: number): Promise<AddressRow> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockActive(tx, id);
      if (before.isDefault) return before;
      const current = await this.currentDefault(tx, before.customerId);
      if (current) await this.clearDefault(tx, current.id);
      return this.write(tx, actor, before, { isDefault: true });
    });
  }

  /** Archives an address; archiving the default makes the oldest other active address the default. */
  archive(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockActive(tx, id);
      await this.write(tx, actor, before, { isDefault: false, archivedAt: sql`now()` }, 'ARCHIVE');
      if (!before.isDefault) return;
      const [next] = await tx
        .select()
        .from(customerAddresses)
        .where(
          and(
            eq(customerAddresses.customerId, before.customerId),
            isNull(customerAddresses.archivedAt),
          ),
        )
        .orderBy(asc(customerAddresses.id))
        .limit(1);
      if (next) await this.write(tx, actor, next, { isDefault: true });
    });
  }

  private async write(
    tx: Tx,
    actor: Actor,
    before: AddressRow,
    values: PgUpdateSetSource<typeof customerAddresses>,
    action = 'UPDATE',
  ): Promise<AddressRow> {
    const [after] = await tx
      .update(customerAddresses)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(customerAddresses.id, before.id))
      .returning();
    if (!after) throw notFound('customer address', before.id);
    await this.audit.record(tx, actor, {
      action,
      entity: 'customer_addresses',
      entityId: before.id,
      before,
      after,
    });
    return after;
  }

  /** The address, under its customer's row lock; archived addresses are read-only. */
  private async lockActive(tx: Tx, id: number): Promise<AddressRow> {
    const [found] = await tx
      .select({ customerId: customerAddresses.customerId })
      .from(customerAddresses)
      .where(eq(customerAddresses.id, id));
    if (!found) throw notFound('customer address', id);
    await lockCustomer(tx, found.customerId);
    const [row] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, id));
    if (!row) throw notFound('customer address', id);
    if (row.archivedAt) throw invalid('id', 'archived', 'the address is archived');
    return row;
  }

  private async currentDefault(tx: Tx, customerId: number): Promise<AddressRow | undefined> {
    const [row] = await tx
      .select()
      .from(customerAddresses)
      .where(
        and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.isDefault, true)),
      );
    return row;
  }

  /** The first step of moving the default flag: the partial unique index allows one at a time. */
  private async clearDefault(tx: Tx, id: number): Promise<void> {
    await tx
      .update(customerAddresses)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(eq(customerAddresses.id, id));
  }
}

async function lockCustomer(tx: Tx, customerId: number): Promise<void> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .for('no key update');
  if (!row) throw notFound('customer', customerId);
}

function validated(input: AddressInput) {
  const lat = input.lat ?? null;
  const lng = input.lng ?? null;
  if ((lat === null) !== (lng === null))
    throw invalid('lng', 'pair', 'latitude and longitude go together');
  if (lat !== null && lng !== null && !isInMongolia(lat, lng)) {
    throw invalid('lat', 'mongolia', 'GPS outside Mongolia');
  }
  const address = optionalText(input.address) ?? null;
  if (address === null && lat === null)
    throw invalid('address', 'required', 'an address or a GPS point');
  return {
    label: optionalText(input.label) ?? null,
    address,
    lat,
    lng,
    note: optionalText(input.note) ?? null,
  };
}

function sameCoordinate(a: Decimal | null, b: Decimal | null): boolean {
  if (a === null || b === null) return a === b;
  return a.eq(b);
}

function snapshot(row: AddressRow): AddressSnapshot {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    zoneId: row.zoneId,
    note: row.note,
  };
}
