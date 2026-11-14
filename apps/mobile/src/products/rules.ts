import type { components } from '@tugeel/api-client';
import { classifyBarcode } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';

// «Бараа нэмэх» in the staff app (ADR-0199): the registration form as the phone holds it, what a
// reading of the photos fills into it, what it still lacks, and the body it saves. Pure, so the
// rules are tested without a phone. The server checks everything again (ADR-0044 #5).

type Schemas = components['schemas'];
export type Proposal = Schemas['ProductAiProposal'];
export type RegistrationBody = Schemas['ProductRegistrationRequest'];
export type Uom = Schemas['Uom'];
export type Category = Schemas['Category'];

/**
 * The shapes of `@tugeel/shared/catalog` and `units`, written again here: the catalog module
 * computes a BigInt power when it loads, which this app's engine may not run. The test holds them
 * equal to the shared ones.
 */
export const SKU_PATTERN = /^[0-9]{1,20}$/;
export const WEIGHT_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;
export const FACTOR_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;
export const NAME_MAX = 200;
/** Photos one reading takes (the API's MAX_AI_PHOTOS). */
export const MAX_AI_PHOTOS = 8;

/** The product image the server finished for this form (ADR-0199). */
export interface FormPicture {
  imageFileId: number;
  thumbFileId: number;
  /** A data URI of the image, for the preview. */
  uri: string;
  made: boolean;
}

export interface ProductForm {
  categoryId: number | null;
  sku: string;
  name: string;
  baseUomId: number | null;
  boxFactor: string;
  weightKg: string;
  baseBarcodes: string[];
  boxBarcodes: string[];
  /** An inner pack («блок»), optional: its quantity empty means none. */
  blockFactor: string;
  blockBarcodes: string[];
  supplier: { id: number; name: string } | null;
  homeWarehouseId: number | null;
}

/** What stays for the next product after a save, as on the web (owner, 2026-10-13). */
export type Sticky = Pick<ProductForm, 'categoryId' | 'supplier' | 'homeWarehouseId' | 'baseUomId'>;

export function emptyForm(sticky: Sticky): ProductForm {
  return {
    ...sticky,
    sku: '',
    name: '',
    boxFactor: '',
    weightKg: '',
    baseBarcodes: [],
    boxBarcodes: [],
    blockFactor: '',
    blockBarcodes: [],
  };
}

export type BarcodeSlot = 'baseBarcodes' | 'boxBarcodes' | 'blockBarcodes';

/** A decimal as people type it on a phone: a comma is a dot, spaces go. */
export const typedNumber = (text: string) => text.replace(/\s/g, '').replace(',', '.');

function exactFactor(text: string, fractional: boolean): boolean {
  if (!FACTOR_PATTERN.test(text)) return false;
  const value = new Decimal(text);
  if (value.lte(0)) return false;
  return fractional ? value.decimalPlaces() <= 3 : value.isInteger();
}

/** The unit of measure with a system code, or null. */
export const uomOf = (uoms: readonly Uom[], code: string) =>
  uoms.find((uom) => uom.code === code) ?? null;

/** The units a product may be counted in: every one but the box, which is its own field. */
export const baseUnitsOf = (uoms: readonly Uom[]) => uoms.filter((uom) => uom.code !== 'BOX');

/**
 * Fills the form with a reading. Only what the model proposed is written, so a field it left
 * empty keeps what the form had; a barcode a product already carries is left out (saving it would
 * be refused), and the screen names that product.
 */
export function withProposal(
  form: ProductForm,
  proposal: Proposal,
  uoms: readonly Uom[],
): ProductForm {
  const taken = new Set(proposal.existing.map((entry) => entry.code));
  const free = (codes: readonly string[]) => codes.filter((code) => !taken.has(code));
  const block = uomOf(uoms, 'BLOCK');
  const blockUnit = block ? proposal.units.find((unit) => unit.uomId === block.id) : undefined;
  const baseBarcodes = free(proposal.baseBarcodes);
  const boxBarcodes = free(proposal.boxBarcodes);
  return {
    ...form,
    categoryId: proposal.categoryId ?? form.categoryId,
    // The category suggests the code: a changed category empties it until the suggestion comes.
    sku: proposal.categoryId !== null && proposal.categoryId !== form.categoryId ? '' : form.sku,
    name: proposal.name ?? form.name,
    baseUomId: proposal.baseUomId ?? form.baseUomId,
    boxFactor: proposal.boxFactor ?? form.boxFactor,
    weightKg: proposal.weightKg ?? form.weightKg,
    baseBarcodes: baseBarcodes.length > 0 ? baseBarcodes : form.baseBarcodes,
    boxBarcodes: boxBarcodes.length > 0 ? boxBarcodes : form.boxBarcodes,
    blockFactor: blockUnit ? blockUnit.factorToBase : form.blockFactor,
    blockBarcodes: blockUnit ? free(blockUnit.barcodes) : form.blockBarcodes,
    supplier: proposal.supplier
      ? { id: proposal.supplier.id, name: proposal.supplier.name }
      : form.supplier,
  };
}

export const FILLED_FIELDS = [
  'category',
  'name',
  'unit',
  'box',
  'weight',
  'barcode',
  'units',
  'supplier',
] as const;
export type FilledField = (typeof FILLED_FIELDS)[number];

/** Which fields a reading filled in, for the line that says so. */
export function filledBy(proposal: Proposal): FilledField[] {
  const taken = new Set(proposal.existing.map((entry) => entry.code));
  const free = (codes: readonly string[]) => codes.some((code) => !taken.has(code));
  const has: Record<FilledField, boolean> = {
    category: proposal.categoryId !== null,
    name: proposal.name !== null,
    unit: proposal.baseUomId !== null,
    box: proposal.boxFactor !== null,
    weight: proposal.weightKg !== null,
    barcode: free(proposal.baseBarcodes) || free(proposal.boxBarcodes),
    units: proposal.units.length > 0,
    supplier: proposal.supplier !== null,
  };
  return FILLED_FIELDS.filter((field) => has[field]);
}

export type AddedBarcode =
  { ok: true; form: ProductForm } | { ok: false; reason: 'invalid' | 'repeated' };

/** A scanned or typed barcode added to one of the form's units; the same code never twice. */
export function withBarcode(form: ProductForm, slot: BarcodeSlot, input: string): AddedBarcode {
  const classified = classifyBarcode(input);
  if (!classified.ok) return { ok: false, reason: 'invalid' };
  const key = classified.value.lookupKey;
  const all = [...form.baseBarcodes, ...form.boxBarcodes, ...form.blockBarcodes];
  const repeated = all.some((code) => {
    const other = classifyBarcode(code);
    return other.ok && other.value.lookupKey === key;
  });
  if (repeated) return { ok: false, reason: 'repeated' };
  return { ok: true, form: { ...form, [slot]: [...form[slot], classified.value.code] } };
}

export function withoutBarcode(form: ProductForm, slot: BarcodeSlot, code: string): ProductForm {
  return { ...form, [slot]: form[slot].filter((one) => one !== code) };
}

export type FormProblemKey =
  | 'category'
  | 'sku'
  | 'name'
  | 'baseUnit'
  | 'boxFactor'
  | 'weight'
  | 'blockFactor'
  | 'supplier'
  | 'warehouse'
  | 'picture';
export type FormProblem = 'required' | 'sku' | 'tooLong' | 'factor' | 'weight' | 'blockUnit';
export type FormProblems = Partial<Record<FormProblemKey, FormProblem>>;

/** What the save still needs; empty when the form may be sent. */
export function problemsOf(
  form: ProductForm,
  uoms: readonly Uom[],
  picture: FormPicture | null,
): FormProblems {
  const problems: FormProblems = {};
  const base = uoms.find((uom) => uom.id === form.baseUomId) ?? null;
  const fractional = base?.fractional ?? false;
  if (form.categoryId === null) problems.category = 'required';
  if (!SKU_PATTERN.test(form.sku.trim())) problems.sku = form.sku.trim() ? 'sku' : 'required';
  const name = form.name.trim();
  if (name === '') problems.name = 'required';
  else if (name.length > NAME_MAX) problems.name = 'tooLong';
  if (base === null || base.code === 'BOX') problems.baseUnit = 'required';
  const box = typedNumber(form.boxFactor);
  if (box === '') problems.boxFactor = 'required';
  else if (!exactFactor(box, fractional)) problems.boxFactor = 'factor';
  const weight = typedNumber(form.weightKg);
  if (weight !== '' && !(WEIGHT_PATTERN.test(weight) && new Decimal(weight).gt(0))) {
    problems.weight = 'weight';
  }
  const block = typedNumber(form.blockFactor);
  if (block !== '') {
    if (!exactFactor(block, fractional)) problems.blockFactor = 'factor';
    // A product counted in blocks has no block as an extra unit.
    else if (base?.code === 'BLOCK' || uomOf(uoms, 'BLOCK') === null) {
      problems.blockFactor = 'blockUnit';
    }
  }
  if (form.supplier === null) problems.supplier = 'required';
  if (form.homeWarehouseId === null) problems.warehouse = 'required';
  if (picture === null) problems.picture = 'required';
  return problems;
}

export const hasProblems = (problems: FormProblems) => Object.keys(problems).length > 0;

/** The registration's body; call it only for a form without problems. */
export function bodyOf(
  form: ProductForm,
  uoms: readonly Uom[],
  picture: FormPicture,
): RegistrationBody {
  if (
    form.categoryId === null ||
    form.baseUomId === null ||
    form.supplier === null ||
    form.homeWarehouseId === null
  ) {
    throw new Error('the form still has problems');
  }
  const block = uomOf(uoms, 'BLOCK');
  const blockFactor = typedNumber(form.blockFactor);
  const weight = typedNumber(form.weightKg);
  return {
    sku: form.sku.trim(),
    name: form.name.trim(),
    categoryId: form.categoryId,
    baseUomId: form.baseUomId,
    weightKg: weight === '' ? null : weight,
    baseBarcodes: form.baseBarcodes,
    boxFactor: typedNumber(form.boxFactor),
    boxBarcodes: form.boxBarcodes,
    units:
      block && blockFactor !== ''
        ? [{ uomId: block.id, factorToBase: blockFactor, barcodes: form.blockBarcodes }]
        : [],
    supplierId: form.supplier.id,
    homeWarehouseId: form.homeWarehouseId,
    fixedBinCode: null,
    images: [{ imageFileId: picture.imageFileId, thumbFileId: picture.thumbFileId }],
  };
}

/** Whether leaving now would lose something typed or photographed. */
export function isTyped(form: ProductForm, picture: FormPicture | null): boolean {
  return (
    picture !== null ||
    form.name.trim() !== '' ||
    form.boxFactor !== '' ||
    form.weightKg !== '' ||
    form.blockFactor !== '' ||
    form.baseBarcodes.length + form.boxBarcodes.length + form.blockBarcodes.length > 0
  );
}

export interface CategoryOption {
  id: number;
  /** Names from the root: «Хүнс / Гурил». */
  path: string;
}

/**
 * Categories with their full paths, depth first, siblings by name. Plain comparison, not
 * `localeCompare`: the engine's locale data is not to be relied on (mobile.md §4).
 */
export function categoryOptions(categories: readonly Category[]): CategoryOption[] {
  const children = new Map<number | null, Category[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  const options: CategoryOption[] = [];
  const visit = (parentId: number | null, prefix: string) => {
    const siblings = [...(children.get(parentId) ?? [])].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id,
    );
    for (const category of siblings) {
      const path = prefix ? `${prefix} / ${category.name}` : category.name;
      options.push({ id: category.id, path });
      visit(category.id, path);
    }
  };
  visit(null, '');
  return options;
}

export type PictureFailure = 'credit' | 'badKey' | 'rateLimit' | 'timeout' | 'empty' | 'other';

/** Which text explains why the picture is the photo as taken: the service's code, never its words. */
export function pictureFailureOf(failure: {
  reason: string;
  status: number | null;
  providerCode: string | null;
}): PictureFailure {
  if (failure.status === 402 || failure.providerCode === 'insufficient_credits') return 'credit';
  if (failure.status === 401 || failure.status === 403) return 'badKey';
  if (failure.status === 429) return 'rateLimit';
  if (failure.reason === 'TIMEOUT' || failure.reason === 'NETWORK') return 'timeout';
  if (failure.reason === 'EMPTY') return 'empty';
  return 'other';
}
