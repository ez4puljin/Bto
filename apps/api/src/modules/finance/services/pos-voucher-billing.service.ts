import { Injectable } from '@nestjs/common';
import { settlementDueDate } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { type Actor, AuditService } from '../../identity';
import { CustomersService } from '../../partners';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { invoices } from '../schema';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { FinanceSettingsService } from './finance-settings.service';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';
import { documentLabel, entryIdOf } from './invoicing.service';

/** A partner's vouchers one till sale took (ADR-0110): each code's face value and what it paid. */
export interface PosVoucherCharge {
  /** The till's number (`К3-261016-0045`), kept on the invoice as its order number. */
  saleNumber: string;
  customerId: number;
  branchId: number | null;
  vouchers: { code: string; face: Decimal; amount: Decimal }[];
}

/**
 * The partner's bill for its vouchers (owner 2026-10-27, ADR-0110 #3): one invoice per sale and
 * partner, written in the transaction that accepts the sale, for the full face value of the codes —
 * due on the partner's settlement day. It has no goods lines and no VAT: the till's own receipt
 * carried the goods and their VAT, booked at the shift's close against VOUCHER_CLEARING. The entry:
 * Dr AR (the face value, the open item), Cr VOUCHER_CLEARING (what the vouchers paid), Cr
 * VOUCHER_BREAKAGE (the unspent rest). The VAT on that rest is TODO-VERIFY with the accountant.
 */
@Injectable()
export class PosVoucherBillingService {
  constructor(
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly settings: FinanceSettingsService,
    private readonly posting: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  async chargeInTx(
    tx: Tx,
    actor: Actor,
    charge: PosVoucherCharge,
  ): Promise<{ invoiceId: number; number: string }> {
    const zero = new Decimal(0);
    const face = charge.vouchers.reduce((sum, voucher) => sum.plus(voucher.face), zero);
    const used = charge.vouchers.reduce((sum, voucher) => sum.plus(voucher.amount), zero);
    if (!face.gt(0) || used.gt(face)) throw new Error('a voucher pays at most its face value');
    const today = businessDate();
    const customer = await this.customers.lockForUpdate(tx, charge.customerId);
    const dueDate = settlementDueDate(customer.settlementGroup, today);
    const number = await this.settings.allocateNumber(tx, 'INVOICE', today);
    const codes = charge.vouchers.map((voucher) => voucher.code).join(', ');
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: customer.id,
        orderId: null,
        orderNumber: charge.saleNumber,
        branchId: charge.branchId,
        invoiceDate: today,
        dueDate,
        paymentMethod: 'CREDIT',
        subtotal: face,
        discountTotal: zero,
        total: face,
        vatTotal: zero,
        cityTaxTotal: zero,
        openAmount: face,
        note: `Ваучер: ${codes}`.slice(0, 300),
        createdBy: null,
      })
      .returning({ id: invoices.id });
    if (!invoice) throw new Error('invoices insert returned no row');
    const party = await this.parties.customerPartyIn(tx, customer.id);
    const lines = voucherChargeLines({ face, used, dueDate });
    const result = await this.posting.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
          docId: String(invoice.id),
          docNo: number,
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.SALES_INVOICE.code,
          documentDate: today,
          currency: 'MNT',
          party,
          dueDate,
          description: documentLabel(number, party.name),
          controlTotal: controlTotal(lines),
          lines: intakeLines(lines),
          attributes: { orderNumber: charge.saleNumber, posSale: charge.saleNumber },
        },
      },
      charge.branchId,
    );
    await tx
      .update(invoices)
      .set({ journalEntryId: entryIdOf(result) })
      .where(eq(invoices.id, invoice.id));
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'invoices',
      entityId: invoice.id,
      after: {
        number,
        orderNumber: charge.saleNumber,
        customerId: customer.id,
        total: face.toFixed(2),
        used: used.toFixed(2),
        dueDate,
        source: 'POS_VOUCHER',
        vouchers: charge.vouchers.map((voucher) => voucher.code),
      },
    });
    return { invoiceId: invoice.id, number };
  }
}

/** The partner's bill: Dr AR the face value, Cr the clearing for what was used, Cr the rest. */
export function voucherChargeLines(charge: {
  face: Decimal;
  used: Decimal;
  dueDate: string;
}): RoleLine[] {
  const zero = new Decimal(0);
  const rest = charge.face.minus(charge.used);
  const lines: RoleLine[] = [
    {
      role: 'AR',
      debit: charge.face,
      credit: zero,
      extra: { openItem: { dueDate: charge.dueDate } },
    },
  ];
  if (charge.used.gt(0)) lines.push({ role: 'VOUCHER_CLEARING', debit: zero, credit: charge.used });
  if (rest.gt(0)) lines.push({ role: 'VOUCHER_BREAKAGE', debit: zero, credit: rest });
  return lines;
}
