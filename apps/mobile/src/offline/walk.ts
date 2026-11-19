import type { components } from '@tugeel/api-client';

/**
 * The data the phone keeps for the rep's order without the server (ADR-0225 #2): the shop's
 * products, the customers with their addresses and contacts, the context, the categories and the
 * suppliers, per server and user. Downloaded while online by `refreshKept`, written beside the
 * copy in use and swapped in only when the whole walk is in.
 */

export type KeptProduct = components['schemas']['SalesRepOfflineProduct'];
export type KeptCustomer = components['schemas']['SalesRepOfflineCustomer'];
export type KeptContext = components['schemas']['SalesRepContext'];
export type KeptCategory = components['schemas']['Category'];
export type KeptSupplier = components['schemas']['SalesRepSupplier'];

/** Which copy is in use: its folder, when it was taken and how big it is. */
export interface KeptPointer {
  v: 1;
  /** The folder of this copy (a new one per walk). */
  gen: string;
  /** When the walk finished (ISO). */
  at: string;
  products: number;
  customers: number;
  /** How many files each list is in (one per page). */
  productFiles: number;
  customerFiles: number;
}

/** Everything kept, read back. */
export interface KeptData {
  at: string;
  products: KeptProduct[];
  customers: KeptCustomer[];
  context: KeptContext;
  categories: KeptCategory[];
  suppliers: KeptSupplier[];
}

/** The server's walks and small answers; each rejects when the server does not answer. */
export interface KeptSource {
  products(cursor: string | null): Promise<{ data: KeptProduct[]; nextCursor: string | null }>;
  customers(cursor: string | null): Promise<{ data: KeptCustomer[]; nextCursor: string | null }>;
  context(): Promise<KeptContext>;
  categories(): Promise<KeptCategory[]>;
  suppliers(): Promise<KeptSupplier[]>;
}

/** The phone's side: files per copy, and the pointer to the copy in use. */
export interface KeptDisk {
  /** Which server and user these files are (one walk at a time per id). */
  readonly id: string;
  loadPointer(): Promise<KeptPointer | null>;
  savePointer(pointer: KeptPointer): Promise<void>;
  write(gen: string, name: string, text: string): Promise<void>;
  read(gen: string, name: string): Promise<string>;
  /** The copies on the phone (their folders). */
  gens(): Promise<string[]>;
  removeGen(gen: string): Promise<void>;
}

/** How far a walk is: what it is downloading and how many rows are in. */
export interface WalkProgress {
  phase: 'products' | 'customers' | 'rest';
  rows: number;
}

/** A walk never follows more pages than this (a cursor that never ends is a server fault). */
const MAX_PAGES = 1000;

const productFile = (at: number) => `p-${at}.json`;
const customerFile = (at: number) => `c-${at}.json`;

export function isPointer(value: unknown): value is KeptPointer {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<KeptPointer>;
  return (
    p.v === 1 &&
    typeof p.gen === 'string' &&
    typeof p.at === 'string' &&
    typeof p.products === 'number' &&
    typeof p.customers === 'number' &&
    typeof p.productFiles === 'number' &&
    typeof p.customerFiles === 'number'
  );
}

/** Thrown when a walk's store is gone (signed out, another server): it stops where it is. */
export class WalkStopped extends Error {
  constructor() {
    super('the walk was stopped');
    this.name = 'WalkStopped';
  }
}

/** The whole copy a walk wrote is on the disk: every file, and the rows it downloaded. */
async function verify(disk: KeptDisk, pointer: KeptPointer): Promise<void> {
  let products = 0;
  for (let at = 0; at < pointer.productFiles; at += 1) {
    products += (JSON.parse(await disk.read(pointer.gen, productFile(at))) as unknown[]).length;
  }
  let customers = 0;
  for (let at = 0; at < pointer.customerFiles; at += 1) {
    customers += (JSON.parse(await disk.read(pointer.gen, customerFile(at))) as unknown[]).length;
  }
  for (const name of ['context.json', 'categories.json', 'suppliers.json']) {
    JSON.parse(await disk.read(pointer.gen, name));
  }
  if (products !== pointer.products || customers !== pointer.customers) {
    throw new Error('the kept copy is incomplete');
  }
}

/**
 * Downloads everything into a new folder, one page after another (never in parallel: the apps
 * never lag the server), checks that the whole copy is on the disk, then points at it and, once
 * the pointer is confirmed, removes every other folder. A walk that fails, or whose store is gone
 * (`alive` false), never moves the pointer and removes only its own folder.
 */
export async function refreshKept(
  source: KeptSource,
  disk: KeptDisk,
  options: {
    now: () => Date;
    newGen: () => string;
    onProgress?: (p: WalkProgress) => void;
    alive?: () => boolean;
  },
): Promise<KeptPointer> {
  const gen = options.newGen();
  const check = () => {
    if (options.alive && !options.alive()) throw new WalkStopped();
  };
  try {
    let cursor: string | null = null;
    let products = 0;
    let productFiles = 0;
    do {
      if (productFiles >= MAX_PAGES) throw new Error('too many product pages');
      check();
      const page = await source.products(cursor);
      check();
      await disk.write(gen, productFile(productFiles), JSON.stringify(page.data));
      productFiles += 1;
      products += page.data.length;
      cursor = page.nextCursor;
      options.onProgress?.({ phase: 'products', rows: products });
    } while (cursor !== null);

    let customers = 0;
    let customerFiles = 0;
    cursor = null;
    do {
      if (customerFiles >= MAX_PAGES) throw new Error('too many customer pages');
      check();
      const page = await source.customers(cursor);
      check();
      await disk.write(gen, customerFile(customerFiles), JSON.stringify(page.data));
      customerFiles += 1;
      customers += page.data.length;
      cursor = page.nextCursor;
      options.onProgress?.({ phase: 'customers', rows: customers });
    } while (cursor !== null);

    options.onProgress?.({ phase: 'rest', rows: products + customers });
    check();
    const context = await source.context();
    const categories = await source.categories();
    const suppliers = await source.suppliers();
    check();
    await disk.write(gen, 'context.json', JSON.stringify(context));
    await disk.write(gen, 'categories.json', JSON.stringify(categories));
    await disk.write(gen, 'suppliers.json', JSON.stringify(suppliers));

    const pointer: KeptPointer = {
      v: 1,
      gen,
      at: options.now().toISOString(),
      products,
      customers,
      productFiles,
      customerFiles,
    };
    await verify(disk, pointer);
    check();
    // The swap: from here on this copy is the one in use.
    await disk.savePointer(pointer);
    // Only once the pointer names this copy are the others removed.
    const confirmed = await disk.loadPointer().catch(() => null);
    if (confirmed?.gen === gen) {
      for (const other of await disk.gens().catch(() => [])) {
        if (other !== gen) await disk.removeGen(other).catch(() => undefined);
      }
    }
    return pointer;
  } catch (error) {
    // Never the copy the pointer names (a pointer stored before a later step failed).
    const named = await disk.loadPointer().catch(() => null);
    if (named?.gen !== gen) await disk.removeGen(gen).catch(() => undefined);
    throw error;
  }
}

/** Reads the copy a pointer names; rejects when a file is missing or unreadable. */
export async function readKept(disk: KeptDisk, pointer: KeptPointer): Promise<KeptData> {
  const products: KeptProduct[] = [];
  for (let at = 0; at < pointer.productFiles; at += 1) {
    const rows = JSON.parse(await disk.read(pointer.gen, productFile(at))) as KeptProduct[];
    for (const row of rows) products.push(row);
  }
  const customers: KeptCustomer[] = [];
  for (let at = 0; at < pointer.customerFiles; at += 1) {
    const rows = JSON.parse(await disk.read(pointer.gen, customerFile(at))) as KeptCustomer[];
    for (const row of rows) customers.push(row);
  }
  return {
    at: pointer.at,
    products,
    customers,
    context: JSON.parse(await disk.read(pointer.gen, 'context.json')) as KeptContext,
    categories: JSON.parse(await disk.read(pointer.gen, 'categories.json')) as KeptCategory[],
    suppliers: JSON.parse(await disk.read(pointer.gen, 'suppliers.json')) as KeptSupplier[],
  };
}
