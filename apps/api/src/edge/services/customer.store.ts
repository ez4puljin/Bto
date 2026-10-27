import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { EdgeCustomer, PosCustomerFeed, PosCustomerStanding } from '@tugeel/shared/pos';
import {
  matchesQuery,
  matchesStrictly,
  queryTerms,
  type SearchKeys,
  searchKeys,
} from '@tugeel/shared/text';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { notFound } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeOutbox, edgeSales, edgeState } from '../db/schema';

const SEARCH_LIMIT = 20;

/**
 * The customers a till may charge (ADR-0109), as the centre's feed last answered: kept in the
 * edge's database so a restart sells on credit at once, indexed in memory for the till's search.
 * What this edge sold on credit and the centre has not counted yet is added from its own sales.
 */
@Injectable()
export class CustomerStore implements OnModuleInit {
  private feed: PosCustomerFeed | null = null;
  private byId = new Map<number, PosCustomerStanding>();
  private search: { customer: PosCustomerStanding; keys: SearchKeys }[] = [];

  constructor(@Inject(EDGE_DB) private readonly db: EdgeDb) {}

  async onModuleInit(): Promise<void> {
    const [row] = await this.db
      .select({ customers: edgeState.customers })
      .from(edgeState)
      .where(eq(edgeState.id, 1));
    if (row?.customers) this.index(row.customers);
  }

  version(): string | null {
    return this.feed?.version ?? null;
  }

  generatedAt(): string | null {
    return this.feed?.generatedAt ?? null;
  }

  get(id: number): PosCustomerStanding {
    const customer = this.byId.get(id);
    if (!customer) throw notFound('customer', id);
    return customer;
  }

  /** Keeps a new feed (or only the pull time when the centre said it is unchanged). */
  async apply(feed: PosCustomerFeed | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(edgeState)
      .values({
        id: 1,
        ...(feed ? { customers: feed, customersVersion: feed.version } : {}),
        customersPulledAt: now,
      })
      .onConflictDoUpdate({
        target: edgeState.id,
        set: {
          ...(feed ? { customers: feed, customersVersion: feed.version } : {}),
          customersPulledAt: now,
          updatedAt: now,
        },
      });
    if (feed) this.index(feed);
  }

  /** By code, name, phone, TIN or registration number, with what is left of each limit. */
  async find(query: string): Promise<EdgeCustomer[]> {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const code = query.trim();
    const first: PosCustomerStanding[] = [];
    const strict: PosCustomerStanding[] = [];
    const loose: PosCustomerStanding[] = [];
    for (const { customer, keys } of this.search) {
      if (customer.code === code || customer.tin === code || customer.regNo === code) {
        first.push(customer);
      } else if (matchesStrictly(keys, terms)) strict.push(customer);
      else if (matchesQuery(keys, terms)) loose.push(customer);
      if (strict.length >= SEARCH_LIMIT) break;
    }
    const found = [...first, ...strict, ...loose].slice(0, SEARCH_LIMIT);
    const pending = await this.pending(
      found.map((customer) => customer.id),
      this.generatedAt(),
    );
    return found.map((customer) => this.view(customer, pending.get(customer.id)));
  }

  /** One customer as the till shows it. */
  async one(id: number): Promise<EdgeCustomer> {
    const customer = this.get(id);
    const pending = await this.pending([id], this.generatedAt());
    return this.view(customer, pending.get(id));
  }

  /**
   * What this edge sold on credit to these customers that the centre has not counted (returns
   * taken off): every document not replayed yet and, with `since`, those replayed after the feed
   * was built. Without `since` (the centre's live check) only those not replayed yet.
   */
  async pending(
    customerIds: readonly number[],
    since: string | null,
  ): Promise<Map<number, Decimal>> {
    if (customerIds.length === 0) return new Map();
    const signed = sql<string>`coalesce(sum(CASE WHEN ${edgeSales.kind} = 'RETURN' THEN -${edgeSales.creditAmount} ELSE ${edgeSales.creditAmount} END), 0)`;
    const notCounted = since
      ? or(
          ne(edgeOutbox.status, 'SENT'),
          isNull(edgeOutbox.sentAt),
          gt(edgeOutbox.sentAt, new Date(since)),
        )
      : ne(edgeOutbox.status, 'SENT');
    const rows = await this.db
      .select({ customerId: edgeSales.customerId, total: signed })
      .from(edgeSales)
      .innerJoin(
        edgeOutbox,
        and(eq(edgeOutbox.clientId, edgeSales.clientId), eq(edgeOutbox.kind, edgeSales.kind)),
      )
      .where(
        and(
          inArray(edgeSales.customerId, [...customerIds]),
          gt(edgeSales.creditAmount, new Decimal(0)),
          notCounted,
        ),
      )
      .groupBy(edgeSales.customerId);
    return new Map(
      rows.flatMap((row) =>
        row.customerId === null ? [] : [[row.customerId, new Decimal(row.total)] as const],
      ),
    );
  }

  private view(customer: PosCustomerStanding, pending: Decimal | undefined): EdgeCustomer {
    const available =
      customer.creditLimit === null
        ? null
        : new Decimal(customer.creditLimit)
            .minus(customer.exposure)
            .minus(pending ?? new Decimal(0));
    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      tin: customer.tin,
      phone: customer.phone,
      creditHold: customer.creditHold,
      creditLimit: customer.creditLimit,
      available: available?.toFixed(2) ?? null,
    };
  }

  private index(feed: PosCustomerFeed): void {
    this.feed = feed;
    this.byId = new Map(feed.customers.map((customer) => [customer.id, customer]));
    this.search = feed.customers.map((customer) => ({
      customer,
      keys: searchKeys(
        customer.name,
        [customer.code, customer.phone, customer.tin, customer.regNo].filter(
          (value): value is string => value !== null,
        ),
      ),
    }));
  }
}
