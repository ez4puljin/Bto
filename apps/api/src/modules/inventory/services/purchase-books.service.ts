import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Db, Tx } from '../../../common/db/db.types';
import { CatalogService, TaxService } from '../../catalog';
import type { Actor } from '../../identity';
import { SuppliersService } from '../../partners';
import {
  PURCHASE_BOOKS,
  type PurchaseBooks,
  type ReceiptBookFacts,
  type SupplierReturnFacts,
} from '../hooks';

/**
 * The purchase side of the books, seen from inventory (F3, ADR-0091): the VAT rule a receipt and a
 * supplier return share (ADR-0078 #1: the company's rate when the company and the supplier both pay
 * VAT, else 0; per line 0 for a product exempt from VAT), and the PURCHASE_BOOKS hook that finance
 * binds, called inside the posting's transaction (nothing bound: nothing booked).
 */
@Injectable()
export class PurchaseBooksService implements OnModuleInit {
  private books: PurchaseBooks | null = null;

  constructor(
    private readonly catalog: CatalogService,
    private readonly suppliers: SuppliersService,
    private readonly tax: TaxService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.books = this.moduleRef.get<PurchaseBooks>(PURCHASE_BOOKS, { strict: false });
    } catch {
      this.books = null;
    }
  }

  /** The VAT inside a supplier's prices on a date. */
  async supplierRate(
    executor: Db | Tx,
    supplierId: number,
    onDate: string | null,
  ): Promise<Decimal> {
    const company = await this.tax.companyRates(onDate ?? businessDate(), executor);
    if (!company.vatPayer) return new Decimal(0);
    const [supplier] = await this.suppliers.getMany([supplierId], executor);
    return supplier?.vatPayer ? company.vatRatePct : new Decimal(0);
  }

  /** Each line's VAT rate: the document's for a product that carries VAT, 0 for an exempt one. */
  async lineRates(
    executor: Db | Tx,
    lines: readonly { id: number; productId: number }[],
    rate: Decimal,
  ): Promise<Map<number, Decimal>> {
    if (rate.isZero()) return new Map(lines.map((line) => [line.id, new Decimal(0)]));
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    return new Map(
      lines.map((line) => [
        line.id,
        products.get(line.productId)?.vatType === 'VAT_ABLE' ? rate : new Decimal(0),
      ]),
    );
  }

  async receiptCostedInTx(tx: Tx, actor: Actor, facts: ReceiptBookFacts): Promise<void> {
    await this.books?.receiptCostedInTx(tx, actor, facts);
  }

  async supplierReturnPostedInTx(tx: Tx, actor: Actor, facts: SupplierReturnFacts): Promise<void> {
    await this.books?.supplierReturnPostedInTx(tx, actor, facts);
  }

  async supplierReturnReversedInTx(
    tx: Tx,
    actor: Actor,
    docId: string,
    reason: string,
  ): Promise<void> {
    await this.books?.supplierReturnReversedInTx(tx, actor, docId, reason);
  }
}
