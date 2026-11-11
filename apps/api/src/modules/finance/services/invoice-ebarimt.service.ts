import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode } from '@tugeel/shared/gtin';
import { type RelayReceiptLine, wholesalePaymentCode } from '@tugeel/shared/mn';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import {
  EbarimtReceiptsService,
  type PrepareRequest,
  type ReceiptSourceKey,
  type ReceiptView,
} from '../../ebarimt';
import { BTO_SOURCE, FIN_DOC_TYPES, FinContexts } from '../../fin-bridge';
import type { Actor, AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { invoiceLines, invoices } from '../schema';

/**
 * An invoice's e-Barimt receipt (ADR-0185): finance builds the receipt request from its own
 * invoice — the buyer from partners, the classification and tax product codes and the barcodes
 * from catalog — and hands it to the ebarimt module by value, keyed `BTO / SALES_INVOICE / <id>`.
 * A credit sale gets no receipt in this version (TODO-VERIFY with the accountant: which PosAPI
 * payment code a credit sale carries; the till's credit sales get none either, ADR-0109).
 */
@Injectable()
export class InvoiceEbarimtService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly customers: CustomersService,
    private readonly contexts: FinContexts,
    private readonly receipts: EbarimtReceiptsService,
  ) {}

  async sourceOf(invoiceId: number): Promise<ReceiptSourceKey> {
    return {
      companyCode: await this.contexts.companyCode(),
      system: BTO_SOURCE,
      docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
      docId: String(invoiceId),
    };
  }

  /**
   * In the sale's transaction, after the invoice: writes its receipt for the store edge to issue.
   * Null when the invoice gets none (a credit sale, nothing to pay). A buyer or a line that cannot
   * make a receipt never fails the sale: the receipt is written ERROR with its reason.
   */
  async prepareInTx(tx: Tx, actor: Actor, invoiceId: number): Promise<number | null> {
    const request = await this.requestInTx(tx, invoiceId);
    if (!request) return null;
    return (await this.receipts.prepareInTx(tx, actor, request)).id;
  }

  /** The invoice was voided, in the void's transaction: its receipt is cancelled or queued for it. */
  async cancelInTx(tx: Tx, actor: Actor, invoiceId: number, reason: string): Promise<void> {
    await this.receipts.requestCancelInTx(tx, actor, await this.sourceOf(invoiceId), reason);
  }

  /**
   * «Дахин бэлтгэх» (`finance.invoices.manage`): a receipt in ERROR is built again from the
   * invoice with today's data (the customer's TIN typed in, a product's code filled) and waits for
   * the store edge. Only an issued invoice whose receipt is ERROR (409 otherwise).
   */
  async retry(ctx: AuthContext, invoiceId: number): Promise<ReceiptView> {
    const source = await this.sourceOf(invoiceId);
    await inTransaction(this.db, async (tx) => {
      const [invoice] = await tx
        .select({ status: invoices.status, number: invoices.number })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');
      if (!invoice) throw notFound('invoice', invoiceId);
      const existing = await this.receipts.bySourceInTx(tx, source, true);
      if (invoice.status !== 'ISSUED' || existing?.status !== 'ERROR') {
        throw new AppError(
          'EBARIMT_RECEIPT_STATE_INVALID',
          `invoice ${invoice.number} has no receipt to prepare again`,
          { status: existing?.status ?? 'NONE' },
        );
      }
      const request = await this.requestInTx(tx, invoiceId);
      if (!request) {
        throw new AppError(
          'EBARIMT_RECEIPT_STATE_INVALID',
          `invoice ${invoice.number} gets no receipt`,
          { status: existing.status },
        );
      }
      await this.receipts.prepareInTx(tx, ctx, request);
    });
    const state = await this.receipts.stateOf(source);
    if (!state) throw notFound('ebarimt_receipt', invoiceId);
    return state;
  }

  /** The invoice's receipt for its panel; null when it has none. */
  async stateOf(invoiceId: number): Promise<ReceiptView | null> {
    return this.receipts.stateOf(await this.sourceOf(invoiceId));
  }

  private async requestInTx(tx: Tx, invoiceId: number): Promise<PrepareRequest | null> {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw notFound('invoice', invoiceId);
    const code = wholesalePaymentCode(invoice.paymentMethod);
    if (code === null || invoice.total.lte(0)) return null;
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.lineNo));
    const attributes = await this.catalog.ebarimtAttributes(
      lines.map((line) => line.productId),
      lines.map((line) => line.productUnitId),
      tx,
    );
    const customer = await this.customers.get(invoice.customerId, tx);
    const receiptLines: RelayReceiptLine[] = lines.map((line) => {
      const product = attributes.products.get(line.productId);
      const printed = attributes.barcodes.get(line.productUnitId);
      const classified = printed ? classifyBarcode(printed) : null;
      return {
        name: line.productName,
        barCode: classified?.ok ? classified.value.code : null,
        barCodeType: classified?.ok ? classified.value.barcodeType : 'UNDEFINED',
        classificationCode: product?.classificationCode ?? null,
        taxType: line.vatType,
        taxProductCode: product?.taxProductCode ?? null,
        measureUnit: line.uomName,
        qty: line.qty.toFixed(3),
        total: line.total.toFixed(2),
        vat: line.vatAmount.toFixed(2),
        cityTax: line.cityTaxAmount.toFixed(2),
      };
    });
    return {
      source: await this.sourceOf(invoiceId),
      docNumber: invoice.number,
      orderNumber: invoice.orderNumber,
      buyerName: customer.name,
      buyer: { kind: customer.kind, tin: customer.tin, consumerNo: customer.consumerNo },
      lines: receiptLines,
      payments: [{ code, amount: invoice.total.toFixed(2) }],
      total: invoice.total,
      vatTotal: invoice.vatTotal,
      cityTaxTotal: invoice.cityTaxTotal,
    };
  }
}
