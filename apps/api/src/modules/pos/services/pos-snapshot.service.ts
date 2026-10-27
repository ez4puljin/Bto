import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PosSnapshot, SnapshotProgram } from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { CatalogService, CategoriesService, TaxService } from '../../catalog';
import { UserNamesService } from '../../identity';
import { DiscountProgramsService, PriceProfilesService, ProductPricesService } from '../../pricing';
import { posCashiers, posTills } from '../schema';
import type { EdgeNode } from './pos-edge-nodes.service';
import { PosPaymentTypesService } from './pos-payment-types.service';
import { PosQuickButtonsService } from './pos-quick-buttons.service';
import { PosSettingsService } from './pos-settings.service';

/**
 * What a store's edge needs to sell offline (ADR-0063 #2, ADR-0067): its node and tills (with the
 * pairing code hashes), the cashiers (PIN hashes, supervisors), every product ready for sale with
 * its units, barcodes, VAT rate and RETAIL price inputs, the price profiles and the RETAIL
 * programs in force today. One JSON document; its version is a hash of its content, so an edge
 * that already holds it gets only the version back. Built on every pull (one edge per store, once a
 * minute), so a pairing code or a PIN set in the office reaches the edge on its next pull.
 */
@Injectable()
export class PosSnapshotService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly tax: TaxService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly programs: DiscountProgramsService,
    private readonly names: UserNamesService,
    private readonly settings: PosSettingsService,
    private readonly quickButtons: PosQuickButtonsService,
    private readonly paymentTypes: PosPaymentTypesService,
  ) {}

  forNode(node: EdgeNode): Promise<PosSnapshot> {
    return this.build(node);
  }

  private async build(node: EdgeNode): Promise<PosSnapshot> {
    const today = businessDate();
    const settings = await this.settings.get();
    const company = await this.tax.companyRates(today);
    const catalogue = await this.catalog.posCatalogue();
    const terms = await this.prices.inForce(
      catalogue.map((product) => product.id),
      today,
    );
    const profileIds = [...new Set([...terms.values()].map((own) => own.profileId))];
    const values = await this.profiles.versionsInForce(profileIds, today);
    const programs: SnapshotProgram[] = [];
    // Every list in a stable order: the version is a hash of the content.
    const inForce = await this.programs.inForce('RETAIL', today);
    for (const program of inForce.sort((a, b) => a.id - b.id)) {
      programs.push({
        id: program.id,
        name: program.name,
        scope: program.scope,
        measure: program.measure,
        effect: program.effect,
        productId: program.productId,
        productUnitId: program.productUnitId,
        categoryIds:
          program.categoryId === null ? null : await this.categories.subtreeIds(program.categoryId),
        countUomId: program.countUomId,
        steps: program.steps.map((step) => ({
          threshold: step.threshold.toString(),
          value: step.value.toString(),
        })),
      });
    }
    const tillRows = await this.db.select().from(posTills).where(eq(posTills.edgeNodeId, node.id));
    const cashierRows = await this.db.select().from(posCashiers).orderBy(asc(posCashiers.userId));
    const userIds = cashierRows.map((row) => row.userId);
    const users = await this.names.summariesOf(userIds);
    const supervisors = await this.names.holdersOf('pos.till.supervise', userIds);
    const body: Omit<PosSnapshot, 'version' | 'generatedAt'> = {
      businessDate: today,
      node: {
        id: node.id,
        code: node.code,
        name: node.name,
        warehouseId: node.warehouseId,
        warehouseName: node.warehouseName ?? '',
      },
      settings: {
        returnWindowDays: settings.returnWindowDays,
        snapshotIntervalSec: settings.snapshotIntervalSec,
        supervisorRequired: settings.supervisorRequired,
        receiptTitle: settings.receiptTitle,
        receiptFooter: settings.receiptFooter,
        ebarimtDistrictCode: settings.ebarimtDistrictCode,
        ebarimtClassificationCode: settings.ebarimtClassificationCode,
      },
      company: {
        name: null,
        vatPayer: company.vatPayer,
        vatRatePct: company.vatRatePct.toFixed(2),
      },
      tills: tillRows
        .sort((a, b) => a.code.localeCompare(b.code, 'mn'))
        .map((till) => ({
          id: till.id,
          code: till.code,
          name: till.name,
          status: till.status,
          pairingCodeHash: till.pairingCodeHash,
          pairingExpiresAt: till.pairingExpiresAt?.toISOString() ?? null,
        })),
      cashiers: cashierRows.flatMap((row) => {
        const user = users.get(row.userId);
        if (!user) return [];
        return [
          {
            userId: row.userId,
            fullName: user.fullName,
            status: row.status === 'ACTIVE' && user.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
            pinHash: row.pinHash,
            supervisor: supervisors.has(row.userId),
          } as const,
        ];
      }),
      products: catalogue.map((product) => {
        const own = terms.get(product.id);
        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          categoryId: product.categoryId,
          vatRatePct: this.tax.ratesFor(product, company).vatRatePct.toFixed(2),
          vatType: product.vatType,
          taxProductCode: product.taxProductCode,
          classificationCode: product.classificationCode,
          units: product.units.map((unit) => ({
            unitId: unit.unitId,
            uomId: unit.uomId,
            uomName: unit.uomName,
            factor: unit.factor.toString(),
            isBase: unit.isBase,
            barcodes: unit.barcodes,
            codes: unit.codes,
          })),
          terms:
            own && values.has(own.profileId)
              ? {
                  warehousePrice: own.warehousePrice.toFixed(2),
                  wholeUomId: own.wholeUomId,
                  profileId: own.profileId,
                }
              : null,
        };
      }),
      profiles: [...values.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, profile]) => ({
          id,
          looseMarkupPct: profile.looseMarkupPct.toString(),
          retailMarkupPct: profile.retailMarkupPct.toString(),
          retailBulkMinQty: profile.retailBulkMinQty?.toString() ?? null,
          retailBulkMarkupPct: profile.retailBulkMarkupPct?.toString() ?? null,
          rounding: profile.rounding,
        })),
      programs,
      quickGroups: await this.quickButtons.forSnapshot(),
      paymentTypes: await this.paymentTypes.forSnapshot(),
    };
    const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 20);
    return { version, generatedAt: new Date().toISOString(), ...body };
  }
}
