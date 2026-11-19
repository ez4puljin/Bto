import { Injectable } from '@nestjs/common';
import { BarcodeService, CatalogImportService } from '../../catalog';

/** What an erxes product is matched by: its code and its barcodes. */
export interface ErxesProductKey {
  code: string | null;
  barcodes: readonly string[];
}

/** The Bto product an erxes product is, or why there is none. */
export type ErxesProductMatch =
  | { productId: number; reason: null }
  | { productId: null; reason: 'PRODUCT_NOT_FOUND' | 'PRODUCT_AMBIGUOUS' };

/**
 * The Bto product an erxes product is (ADR-0218 #6), the one rule the deal copy and Erkhet's stock
 * (ADR-0221) share: the product whose code (SKU) is erxes's product code; else the one product
 * holding that code, or one of erxes's barcodes, as a barcode. A barcode of several products makes
 * the match ambiguous.
 */
@Injectable()
export class ErxesProductMatchService {
  constructor(
    private readonly products: CatalogImportService,
    private readonly barcodes: BarcodeService,
  ) {}

  async match(key: ErxesProductKey): Promise<ErxesProductMatch> {
    const [found] = await this.matchMany([key]);
    return found ?? { productId: null, reason: 'PRODUCT_NOT_FOUND' };
  }

  /** The same, for many: the codes are looked up as SKUs at once, the barcodes one by one. */
  async matchMany(keys: readonly ErxesProductKey[]): Promise<ErxesProductMatch[]> {
    const codes = keys.map((key) => key.code).filter((code): code is string => code !== null);
    const bySku = new Map<string, number>();
    for (const product of await this.products.productsBySku(codes)) {
      if (!bySku.has(product.sku)) bySku.set(product.sku, product.id);
    }
    const found: ErxesProductMatch[] = [];
    for (const key of keys) {
      const sku = key.code === null ? undefined : bySku.get(key.code);
      found.push(sku === undefined ? await this.byBarcode(key) : { productId: sku, reason: null });
    }
    return found;
  }

  /** The erxes code first (the old codes live on as barcodes), then erxes's own barcodes. */
  private async byBarcode(key: ErxesProductKey): Promise<ErxesProductMatch> {
    for (const code of [key.code, ...key.barcodes]) {
      if (!code) continue;
      const owners = new Set((await this.barcodes.lookup(code)).map((hit) => hit.productId));
      if (owners.size > 1) return { productId: null, reason: 'PRODUCT_AMBIGUOUS' };
      const [only] = owners;
      if (only !== undefined) return { productId: only, reason: null };
    }
    return { productId: null, reason: 'PRODUCT_NOT_FOUND' };
  }
}
