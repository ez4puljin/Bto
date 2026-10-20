import { Inject, Injectable } from '@nestjs/common';
import type { PartyIn } from '@tugeel/fin-contract';
import type { Tx } from '../../../common/db/db.types';
import { FIN_DB, type FinDb, type FinPartyRef, FinPartiesService } from '../../../finance-core';
import { type Actor, systemActor } from '../../identity';
import {
  type CustomerChangedHook,
  type CustomerPartyFacts,
  CustomersService,
} from '../../partners';
import { customerIdOfRef, customerRef } from '../installation';
import { FinContexts } from './contexts.service';

/**
 * Bto's customers as Finance Core parties (ADR-0070 #8, ADR-0084): bound as partners'
 * CUSTOMER_CHANGED_HOOK, so a new customer, or a change of its kind, name, TIN or register
 * number, reaches its party in the same transaction, in the api and in the worker (imports).
 */
@Injectable()
export class FinPartiesBridge implements CustomerChangedHook {
  constructor(
    @Inject(FIN_DB) private readonly db: FinDb,
    private readonly contexts: FinContexts,
    private readonly parties: FinPartiesService,
    private readonly customers: CustomersService,
  ) {}

  async onCustomerChanged(tx: Tx, actor: Actor, customer: CustomerPartyFacts): Promise<void> {
    await this.parties.upsertPartyInTx(tx, this.contexts.forSource(actor), {
      company: await this.contexts.companyCode(),
      party: {
        ref: customerRef(customer.id),
        kind: customer.kind,
        name: customer.name,
        ...(customer.tin === null ? {} : { tin: customer.tin }),
        ...(customer.regNo === null ? {} : { registerNo: customer.regNo }),
      },
    });
  }

  /**
   * The party a journal line of this customer carries (ADR-0089): the customer's party, made now
   * from the customer's facts when the core has not seen it (a customer written before the hook).
   */
  async customerPartyInTx(tx: Tx, actor: Actor, customerId: number): Promise<string> {
    const known = await this.resolveCustomerParty(tx, actor, customerId);
    if (known) return known.partyId;
    const [customer] = await this.customers.getMany([customerId], tx);
    if (!customer) throw new Error(`customer ${customerId} does not exist`);
    await this.onCustomerChanged(tx, actor, customer);
    const made = await this.resolveCustomerParty(tx, actor, customerId);
    if (!made) throw new Error(`customer ${customerId} has no party`);
    return made.partyId;
  }

  /** A customer as the intake names its party (F2): the ref and the customer's facts. */
  async customerPartyIn(tx: Tx, customerId: number): Promise<PartyIn> {
    const [customer] = await this.customers.getMany([customerId], tx);
    if (!customer) throw new Error(`customer ${customerId} does not exist`);
    return {
      ref: customerRef(customer.id),
      kind: customer.kind,
      name: customer.name.trim().slice(0, 200),
      ...(customer.tin === null ? {} : { tin: customer.tin }),
      ...(customer.regNo === null ? {} : { registerNo: customer.regNo }),
    };
  }

  /** The parties of these customers that the core knows, by customer id (journal filters). */
  async partiesOfCustomers(customerIds: readonly number[]): Promise<Map<number, string>> {
    const byRef = await this.parties.partiesOf(this.db, this.readContext(), {
      company: await this.contexts.companyCode(),
      refs: customerIds.map(customerRef),
    });
    return new Map(
      customerIds.flatMap((id) => {
        const party = byRef.get(customerRef(id));
        return party === undefined ? [] : [[id, party] as const];
      }),
    );
  }

  /** The customers of these parties (journal lines), by party id; other parties are left out. */
  async customersOfParties(partyIds: readonly string[]): Promise<Map<string, number>> {
    const refs = await this.parties.refsOf(this.db, this.readContext(), {
      company: await this.contexts.companyCode(),
      partyIds,
    });
    const result = new Map<string, number>();
    for (const [partyId, ref] of refs) {
      const id = customerIdOfRef(ref);
      if (id !== null) result.set(partyId, id);
    }
    return result;
  }

  private readContext() {
    return this.contexts.forSource(systemActor('fin-bridge:parties'));
  }

  /** The party of a customer, or null when the core has not seen it (F2 posts invoices with it). */
  async resolveCustomerParty(
    tx: Tx,
    actor: Actor,
    customerId: number,
  ): Promise<FinPartyRef | null> {
    return this.parties.resolvePartyInTx(tx, this.contexts.forSource(actor), {
      company: await this.contexts.companyCode(),
      ref: customerRef(customerId),
    });
  }
}
