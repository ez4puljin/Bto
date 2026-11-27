import { Injectable, Module } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { ExpirySaleInput, ExpiryReturnInput, ExpirySaleOffer } from '@tugeel/shared/expiry';
import { taxSplit } from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import type { Db, Tx } from './common/db/db.types';
import { AppError, invalid } from './common/errors/app-error';
import { CatalogModule, CatalogService, TaxService } from './modules/catalog';
import {
  ExpiryModule,
  ExpiryCommerceService,
  ExpiryPosExceptionsService,
  EXPIRY_PAYROLL_SOURCE,
  type ExpiryPayrollSource,
  type ExpiryPayrollSourceInput,
  EXPIRY_SALE_CONTEXTS,
  type ExpirySaleContext,
  type ExpirySaleContexts,
} from './modules/expiry';
import { type Actor, IdentityModule, OrgService } from './modules/identity';
import { InventoryModule, ProductLocationsService } from './modules/inventory';
import { POS_EXPIRY_OFFERS, type PosExpiryOffers, PosModule, PosTillsService } from './modules/pos';
import { PayrollModule, PayrollSourceDeductionsService } from './modules/payroll';
import {
  FIXED_SOURCE_PRICES,
  type FixedSourcePrices,
  PricingModule,
  PriceQuoteService,
} from './modules/pricing';
import {
  EXPIRY_SALE_POSTING,
  type ExpirySalePosting,
  SalesModule,
  SalesPipelinesService,
} from './modules/sales';

/** Joins public module ports at the application boundary, avoiding dependency cycles. */
@Injectable()
export class ExpiryCommerceContexts implements ExpirySaleContexts, FixedSourcePrices {
  constructor(
    private readonly tills: PosTillsService,
    private readonly pipelines: SalesPipelinesService,
    private readonly org: OrgService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly prices: PriceQuoteService,
    private readonly tax: TaxService,
    private readonly expiry: ExpiryCommerceService,
  ) {}

  async list(executor: Db | Tx): Promise<ExpirySaleContext[]> {
    const tills = await this.tills.saleContexts(executor);
    const tillWarehouses = await this.org.warehouseNames(
      tills.map((till) => till.warehouseId),
      executor,
    );
    const pipelines = await this.pipelines.saleContexts(executor);
    const warehouses = (await this.org.listWarehouses({ kind: 'WHOLESALE' }, executor)).filter(
      (row) => row.status === 'ACTIVE',
    );
    return [
      ...tills.map((till): ExpirySaleContext => ({
        warehouseId: till.warehouseId,
        channel: 'RETAIL',
        contextId: till.id,
        name: `${till.name} / ${tillWarehouses.get(till.warehouseId) ?? till.warehouseId}`,
      })),
      ...pipelines.flatMap((pipeline) =>
        warehouses.map((warehouse): ExpirySaleContext => ({
          warehouseId: warehouse.id,
          channel: 'WHOLESALE',
          contextId: pipeline.id,
          name: `${pipeline.name} / ${warehouse.name}`,
        })),
      ),
    ];
  }

  async quote(
    executor: Db | Tx,
    productId: number,
    context: ExpirySaleContext,
    override?: Decimal,
  ): Promise<{ unitPrice: string | null; netUnitPrice: string | null }> {
    const [product] = await this.catalog.getMany([productId], executor);
    if (!product) return { unitPrice: null, netUnitPrice: null };
    if (
      context.channel === 'WHOLESALE' &&
      (await this.locations.homeOf([productId], executor)).get(productId) !== context.warehouseId
    ) {
      return { unitPrice: null, netUnitPrice: null };
    }
    const today = businessDate();
    const price =
      override ??
      (
        await this.prices.quote(
          {
            list: context.channel,
            date: today,
            pipelineId: context.channel === 'WHOLESALE' ? context.contextId : null,
            tillId: context.channel === 'RETAIL' ? context.contextId : null,
            lines: [{ productUnitId: product.baseUnit.id, qty: new Decimal(1) }],
          },
          executor,
        )
      ).lines[0]?.result;
    const gross = price instanceof Decimal ? price : price?.priced ? price.total : null;
    if (gross === null) return { unitPrice: null, netUnitPrice: null };
    const rates = this.tax.ratesFor(product, await this.tax.companyRates(today, executor));
    // POS currently includes VAT only; wholesale invoices include VAT and city tax.
    const split = taxSplit(
      gross,
      rates.vatRatePct,
      context.channel === 'RETAIL' ? new Decimal(0) : rates.cityTaxRatePct,
    );
    return { unitPrice: gross.toFixed(2), netUnitPrice: split.net.toFixed(2) };
  }

  async resolve(
    executor: Db | Tx,
    input: Parameters<FixedSourcePrices['resolve']>[1],
  ): Promise<Decimal> {
    const contextId = input.list === 'RETAIL' ? input.tillId : input.pipelineId;
    if (contextId === null)
      throw invalid(
        'expiryBarcode',
        'context',
        'an approved source needs its till or sales pipeline',
      );
    const warehouseId =
      input.list === 'RETAIL'
        ? (await this.tills.get(contextId, executor)).warehouseId
        : (await this.locations.homeOf([input.productId], executor)).get(input.productId);
    if (!warehouseId)
      throw invalid('expiryBarcode', 'warehouse', 'the product needs its sale warehouse');
    // Resolve is read-only and accepts the quote executor; a mutation always revalidates in its transaction.
    const offer = await this.expiry.resolveInTx(executor, {
      barcode: input.barcode,
      productId: input.productId,
      productUnitId: input.productUnitId,
      qtyBase: input.qtyBase,
      warehouseId,
      channel: input.list,
      contextId,
      at: new Date(),
    });
    return new Decimal(offer.unitPrice);
  }
}

/** POS domain failures roll back only the expiry savepoint; technical failures abort the caller. */
@Injectable()
export class ExpirySalePostingAdapter implements ExpirySalePosting, PosExpiryOffers {
  constructor(
    private readonly expiry: ExpiryCommerceService,
    private readonly exceptions: ExpiryPosExceptionsService,
  ) {}
  lockInTx(tx: Tx): Promise<void> {
    return this.expiry.lockInTx(tx);
  }
  async recordSaleInTx(tx: Tx, actor: Actor, input: ExpirySaleInput) {
    if (input.sourceKind !== 'POS') return this.expiry.recordSaleInTx(tx, actor, input);
    const previous = await this.exceptions.previous(tx, 'SALE', input.saleId, input.lineId);
    if (previous) return { allocationId: null, allocated: false, reason: previous };
    try {
      return await tx.transaction((nested) => this.expiry.recordSaleInTx(nested, actor, input));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const reason = await this.exceptions.recordSaleInTx(tx, input, error);
      return { allocationId: null, allocated: false, reason };
    }
  }
  async recordReturnInTx(tx: Tx, actor: Actor, input: ExpiryReturnInput): Promise<void> {
    if (input.sourceKind !== 'POS' || !input.expiryContext) {
      return this.expiry.recordReturnInTx(tx, actor, input);
    }
    if (await this.exceptions.previous(tx, 'RETURN', input.returnId, input.returnLineId)) return;
    try {
      await tx.transaction((nested) => this.expiry.recordReturnInTx(nested, actor, input));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await this.exceptions.recordReturnInTx(tx, input, error);
    }
  }
  snapshots(
    executor: Db | Tx,
    filter?: Parameters<PosExpiryOffers['snapshots']>[1],
  ): Promise<ExpirySaleOffer[]> {
    return this.expiry.snapshots(executor, filter);
  }
}

/** Payroll remains the only owner of deduction rows and its shared transaction gate. */
@Injectable()
export class ExpiryPayrollSourceAdapter implements ExpiryPayrollSource {
  constructor(private readonly payroll: PayrollSourceDeductionsService) {}
  lockInTx(tx: Tx): Promise<void> {
    return this.payroll.lockInTx(tx);
  }
  async recordInTx(tx: Tx, actor: Actor, input: ExpiryPayrollSourceInput): Promise<void> {
    await this.payroll.recordInTx(tx, actor, input);
  }
}

@Module({
  imports: [
    ExpiryModule,
    PayrollModule,
    PosModule,
    SalesModule,
    CatalogModule,
    IdentityModule,
    InventoryModule,
    PricingModule,
  ],
  providers: [
    ExpiryCommerceContexts,
    ExpirySalePostingAdapter,
    ExpiryPayrollSourceAdapter,
    { provide: EXPIRY_SALE_POSTING, useExisting: ExpirySalePostingAdapter },
    { provide: POS_EXPIRY_OFFERS, useExisting: ExpirySalePostingAdapter },
    { provide: EXPIRY_PAYROLL_SOURCE, useExisting: ExpiryPayrollSourceAdapter },
    { provide: EXPIRY_SALE_CONTEXTS, useExisting: ExpiryCommerceContexts },
    { provide: FIXED_SOURCE_PRICES, useExisting: ExpiryCommerceContexts },
  ],
})
export class ExpiryCommerceModule {}
