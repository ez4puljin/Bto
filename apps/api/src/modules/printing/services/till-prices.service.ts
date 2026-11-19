import { Injectable } from '@nestjs/common';
import { classifyBarcode, cleanBarcode } from '@tugeel/shared/gtin';
import { Decimal, roundHalfUp } from '@tugeel/shared/money';
import {
  programServes,
  type QuoteLineInput,
  type QuoteProduct,
  type QuoteProgram,
  resolveQuote,
} from '@tugeel/shared/pricing';
import {
  matchesQuery,
  matchesStrictly,
  queryTerms,
  type SearchKeys,
  searchKeys,
} from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import { CatalogService, CategoriesService, type PosCatalogueProduct } from '../../catalog';
import {
  DiscountProgramsService,
  PriceProfilesService,
  ProductPricesService,
  ProgramTargetsService,
} from '../../pricing';
import { PRINT_LIMITS } from '../printing.rules';

/** A product as a label and the staff app's list show it, at one till's prices today. */
export interface LabelItem {
  productId: number;
  name: string;
  code: string;
  /** Every barcode of every current unit, as printed. */
  barcodes: string[];
  /** The base unit's name. */
  unit: string;
  /** One base unit at the till, whole MNT. */
  price: Decimal;
  /** From how many base units the till charges less; null when it never does. */
  bulkQty: Decimal | null;
  /** One base unit's price at that quantity, whole MNT. */
  bulkPrice: Decimal | null;
}

interface Entry {
  product: PosCatalogueProduct;
  keys: SearchKeys;
}

/** Everything the store's tills price with today: the edge's snapshot, held by the api. */
interface Book {
  date: string;
  builtAt: number;
  entries: readonly Entry[];
  byId: ReadonlyMap<number, Entry>;
  byBarcode: ReadonlyMap<string, number>;
  bySku: ReadonlyMap<string, number>;
  products: ReadonlyMap<number, QuoteProduct>;
  programs: readonly QuoteProgram[];
}

/** How long one reading of the catalogue and the prices serves (the edge pulls once a minute). */
const BOOK_TTL_MS = 60_000;

/**
 * A till's prices for labels (ADR-0226 #3): what the till's own server would charge today, by the
 * same pure resolver (`resolveQuote` of `@tugeel/shared/pricing`) over the same inputs the
 * store's snapshot carries (`PosSnapshotService`): every product ready for sale, its terms in force
 * and its profile's values today, and the RETAIL programs in force that serve the till (ADR-0159
 * #5). Each product is priced alone, as the till prices a product it shows; the bulk price is what
 * the till charges a unit at the smallest quantity that costs less (the profile's bulk quantity, or
 * a step of the product's own program). The reading is kept a minute per api process.
 */
@Injectable()
export class TillPricesService {
  private book: Book | null = null;
  private building: Promise<Book> | null = null;

  constructor(
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly programs: DiscountProgramsService,
    private readonly targets: ProgramTargetsService,
  ) {}

  /** Up to 30 products the till sells and prices whose name, code or barcode matches `q`. */
  async search(
    till: { id: number; categoryIds: readonly number[] },
    q: string,
  ): Promise<LabelItem[]> {
    const book = await this.current();
    const terms = queryTerms(q);
    const first: Entry[] = [];
    const found = this.lookup(book, q);
    if (found) first.push(found);
    const strict: Entry[] = [];
    const loose: Entry[] = [];
    const digits = q.trim();
    if (terms.length > 0) {
      for (const entry of book.entries) {
        if (entry.product.sku.toUpperCase() === digits.toUpperCase()) first.push(entry);
        else if (matchesStrictly(entry.keys, terms)) strict.push(entry);
        else if (matchesQuery(entry.keys, terms)) loose.push(entry);
      }
    }
    if (digits.length >= 3) {
      for (const entry of book.entries) {
        if (entry.product.units.some((unit) => unit.codes.some((code) => code.includes(digits)))) {
          loose.push(entry);
        }
      }
    }
    const seen = new Set<number>();
    const items: LabelItem[] = [];
    for (const entry of [...first, ...strict, ...loose]) {
      if (items.length >= PRINT_LIMITS.searchLimit) break;
      if (seen.has(entry.product.id)) continue;
      seen.add(entry.product.id);
      const item = this.itemOf(book, entry, till);
      if (item) items.push(item);
    }
    return items;
  }

  /** The product with this barcode (or code) at the till, or null when it is not sold there. */
  async byCode(
    till: { id: number; categoryIds: readonly number[] },
    code: string,
  ): Promise<LabelItem | null> {
    const book = await this.current();
    const entry = this.lookup(book, code);
    return entry ? this.itemOf(book, entry, till) : null;
  }

  /** These products at the till, in the order asked; null for one not sold or priced there. */
  async items(
    till: { id: number; categoryIds: readonly number[] },
    productIds: readonly number[],
  ): Promise<(LabelItem | null)[]> {
    const book = await this.current();
    return productIds.map((id) => {
      const entry = book.byId.get(id);
      return entry ? this.itemOf(book, entry, till) : null;
    });
  }

  /** Forgets the reading (tests, and after an office change that must show at once). */
  reset(): void {
    this.book = null;
  }

  private lookup(book: Book, raw: string): Entry | undefined {
    const code = cleanBarcode(raw);
    if (code) {
      const classified = classifyBarcode(code);
      const id = classified.ok ? book.byBarcode.get(classified.value.lookupKey) : undefined;
      if (id !== undefined) return book.byId.get(id);
    }
    const sku = book.bySku.get(raw.trim().toUpperCase());
    return sku === undefined ? undefined : book.byId.get(sku);
  }

  private itemOf(
    book: Book,
    entry: Entry,
    till: { id: number; categoryIds: readonly number[] },
  ): LabelItem | null {
    const { product } = entry;
    if (till.categoryIds.length > 0 && !till.categoryIds.includes(product.categoryId)) return null;
    const base = product.units.find((unit) => unit.isBase);
    const quoted = book.products.get(product.id);
    if (!base || !quoted?.terms) return null;
    const programs = book.programs.filter((program) =>
      programServes(program, 'RETAIL', { tillId: till.id }),
    );
    const perUnit = (qty: Decimal): Decimal | null => {
      const line: QuoteLineInput = {
        productId: product.id,
        unitId: base.unitId,
        qty,
        qtyBase: qty,
      };
      const result = resolveQuote([line], { list: 'RETAIL', products: book.products, programs });
      const priced = result.lines[0];
      if (!priced?.priced) return null;
      return roundHalfUp(priced.total.div(qty), 0);
    };
    const price = perUnit(new Decimal(1));
    if (price === null) return null;
    let bulkQty: Decimal | null = null;
    let bulkPrice: Decimal | null = null;
    for (const qty of bulkCandidates(product.id, quoted, programs)) {
      const at = perUnit(qty);
      if (at !== null && at.lt(price)) {
        bulkQty = qty;
        bulkPrice = at;
        break;
      }
    }
    return {
      productId: product.id,
      name: product.name,
      code: product.sku,
      barcodes: [...new Set(product.units.flatMap((unit) => unit.codes))],
      unit: base.uomName,
      price,
      bulkQty,
      bulkPrice,
    };
  }

  private async current(): Promise<Book> {
    const today = businessDate();
    const held = this.book;
    if (held && held.date === today && Date.now() - held.builtAt < BOOK_TTL_MS) return held;
    this.building ??= this.build(today).finally(() => {
      this.building = null;
    });
    const book = await this.building;
    this.book = book;
    return book;
  }

  private async build(date: string): Promise<Book> {
    const catalogue = await this.catalog.posCatalogue();
    const ids = catalogue.map((product) => product.id);
    const terms = await this.prices.inForce(ids, date);
    const values = await this.profiles.versionsInForce(
      [...new Set([...terms.values()].map((own) => own.profileId))],
      date,
    );
    const products = new Map<number, QuoteProduct>();
    const entries: Entry[] = [];
    const byId = new Map<number, Entry>();
    const byBarcode = new Map<string, number>();
    const bySku = new Map<string, number>();
    for (const product of catalogue) {
      const own = terms.get(product.id);
      const profile = own ? values.get(own.profileId) : undefined;
      products.set(product.id, {
        categoryId: product.categoryId,
        units: product.units.map((unit) => ({
          unitId: unit.unitId,
          uomId: unit.uomId,
          factor: unit.factor,
          isBase: unit.isBase,
        })),
        terms:
          own && profile
            ? { warehousePrice: own.warehousePrice, wholeUomId: own.wholeUomId, profile }
            : null,
      });
      const entry = { product, keys: searchKeys(product.name, [product.sku]) };
      entries.push(entry);
      byId.set(product.id, entry);
      bySku.set(product.sku.toUpperCase(), product.id);
      for (const unit of product.units) {
        for (const key of unit.barcodes) if (!byBarcode.has(key)) byBarcode.set(key, product.id);
      }
    }
    const inForce = await this.programs.inForce('RETAIL', date);
    const sets = await this.targets.productSets(inForce);
    const subtrees = new Map<number, ReadonlySet<number>>();
    const programs: QuoteProgram[] = [];
    for (const program of inForce) {
      let categoryIds: ReadonlySet<number> | null = null;
      if (program.categoryId !== null) {
        categoryIds = subtrees.get(program.categoryId) ?? null;
        if (!categoryIds) {
          categoryIds = new Set(await this.categories.subtreeIds(program.categoryId));
          subtrees.set(program.categoryId, categoryIds);
        }
      }
      programs.push({
        ...program,
        categoryIds,
        productIds: sets.get(program.id) ?? null,
        adjust:
          program.adjustKind === 'NONE'
            ? null
            : { kind: program.adjustKind, factor: new Decimal(program.adjustFactor) },
      });
    }
    return {
      date,
      builtAt: Date.now(),
      entries,
      byId,
      byBarcode,
      bySku,
      products,
      programs,
    };
  }
}

/**
 * The quantities (base units, more than one) at which the till may charge a unit less, smallest
 * first: the profile's bulk quantity and the steps of the product's own quantity programs.
 */
function bulkCandidates(
  productId: number,
  product: QuoteProduct,
  programs: readonly QuoteProgram[],
): Decimal[] {
  const found: Decimal[] = [];
  const bulk = product.terms?.profile.retailBulkMinQty;
  if (bulk) found.push(bulk);
  for (const program of programs) {
    if (program.scope !== 'PRODUCT' || program.measure !== 'QTY') continue;
    const mine = program.productId === productId || (program.productIds?.has(productId) ?? false);
    if (!mine) continue;
    for (const step of program.steps) found.push(step.threshold);
  }
  const unique = new Map<string, Decimal>();
  for (const qty of found) {
    if (qty.gt(1) && qty.isInteger()) unique.set(qty.toFixed(), qty);
  }
  return [...unique.values()].sort((a, b) => a.comparedTo(b));
}
