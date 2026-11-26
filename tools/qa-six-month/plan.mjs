#!/usr/bin/env node
import { CUSTOMERS, DAYS, DEPARTMENTS, PRODUCTS, SUPPLIERS, summary } from './dataset.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateDataset() {
  for (const [kind, rows, key] of [
    ['product SKUs', PRODUCTS, 'sku'],
    ['product names', PRODUCTS, 'name'],
    ['supplier codes', SUPPLIERS, 'code'],
    ['supplier names', SUPPLIERS, 'name'],
    ['customer names', CUSTOMERS, 'name'],
  ]) {
    if (new Set(rows.map((row) => row[key])).size !== rows.length)
      throw new Error(`Duplicate ${kind}`);
  }
  if (PRODUCTS.length !== 500 || SUPPLIERS.length !== 60 || CUSTOMERS.length !== 80)
    throw new Error('Unexpected catalogue counts');
  const barcodes = PRODUCTS.flatMap((p) => [p.barcode, p.boxBarcode]);
  if (new Set(barcodes).size !== 1000) throw new Error('Duplicate barcodes');
  if (DAYS.length !== 176 || new Set(DAYS.map((day) => day.slice(0, 7))).size !== 6)
    throw new Error('Unexpected business window');
  for (const product of PRODUCTS) {
    if (!DEPARTMENTS.some((d) => d.key === product.department))
      throw new Error('Unknown department');
    if (SUPPLIERS[product.supplierIndex]?.department !== product.department)
      throw new Error('Supplier/category mismatch');
    if (
      !/^\d{8}$/.test(product.sku) ||
      !/^\d{13}$/.test(product.barcode) ||
      Number(product.baseCost) <= 0 ||
      Number(product.carton) <= 0
    )
      throw new Error('Invalid product source data');
  }
  return summary();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--json'))
    throw new Error('Only --json is supported; this command never writes');
  console.log(JSON.stringify(validateDataset(), null, 2));
}
