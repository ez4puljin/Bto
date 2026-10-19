import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import { type FinPartyRef, FinPartiesService } from '../../../finance-core';
import type { Actor } from '../../identity';
import type { CustomerChangedHook, CustomerPartyFacts } from '../../partners';
import { customerRef } from '../installation';
import { FinContexts } from './contexts.service';

/**
 * Bto's customers as Finance Core parties (ADR-0070 #8, ADR-0084): bound as partners'
 * CUSTOMER_CHANGED_HOOK, so a new customer, or a change of its kind, name, TIN or register
 * number, reaches its party in the same transaction, in the api and in the worker (imports).
 */
@Injectable()
export class FinPartiesBridge implements CustomerChangedHook {
  constructor(
    private readonly contexts: FinContexts,
    private readonly parties: FinPartiesService,
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

  /** The party of a customer, or null when the core has not seen it (P2 posts invoices with it). */
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
