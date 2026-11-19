import type { ApiClient, components } from '@tugeel/api-client';
import * as Crypto from 'expo-crypto';
import { unwrap } from '../api/problem';
import type { JobState } from './job';
import type { LabelProduct } from './list';

// The api of «Үнийн шошго» (docs/modules/mobile.md). The screens call these small functions only.

export type LabelTill = components['schemas']['PriceLabelTill'];
export type PrintStation = components['schemas']['PrintStationChoice'];
export type PrintItem = components['schemas']['PriceLabelLine'];
type Item = components['schemas']['PriceLabelItem'];

/** What the list keeps of a product: the numbers as the strings the app shows. */
function productOf(item: Item): LabelProduct {
  return {
    productId: item.productId,
    name: item.name,
    code: item.code,
    barcodes: item.barcodes,
    unit: item.unit,
    price: String(item.price),
    bulkQty: item.bulkQty === null ? null : String(item.bulkQty),
    bulkPrice: item.bulkPrice === null ? null : String(item.bulkPrice),
  };
}

/** The tills of the caller; none gives the server's «Танд Пос тохируулаагүй байна». */
export async function fetchTills(client: ApiClient): Promise<LabelTill[]> {
  return unwrap(await client.GET('/api/v1/price-labels/tills'));
}

/** Up to 30 products of a till by name, code or barcode (nothing for an empty search). */
export async function searchProducts(
  client: ApiClient,
  tillId: number,
  q: string,
): Promise<LabelProduct[]> {
  const items = unwrap(
    await client.GET('/api/v1/price-labels/products', { params: { query: { tillId, q } } }),
  );
  return items.map(productOf);
}

/** One product by a scanned barcode; null when the server has none («Бараа олдсонгүй», 404). */
export async function productByBarcode(
  client: ApiClient,
  tillId: number,
  code: string,
): Promise<LabelProduct | null> {
  const answer = await client.GET('/api/v1/price-labels/barcode/{code}', {
    params: { path: { code }, query: { tillId } },
  });
  if (answer.response.status === 404) return null;
  return productOf(unwrap(answer));
}

/** The labels drawn as ESC/POS bytes (base64) for a phone's own Bluetooth printer. */
export async function escposOf(
  client: ApiClient,
  body: { tillId: number; items: PrintItem[]; widthDots?: 576 | 384 },
): Promise<{ data: string; labels: number }> {
  return unwrap(await client.POST('/api/v1/price-labels/escpos', { body }));
}

export async function fetchStations(client: ApiClient): Promise<PrintStation[]> {
  return unwrap(await client.GET('/api/v1/print-stations'));
}

/** Queues the labels for a printer on a PC (through the server); one new key per press. */
export async function startPcPrint(
  client: ApiClient,
  body: { tillId: number; stationId: number; items: PrintItem[] },
): Promise<{ jobId: number; labels: number }> {
  return unwrap(
    await client.POST('/api/v1/price-labels/print', {
      body,
      params: { header: { 'Idempotency-Key': Crypto.randomUUID() } },
    }),
  );
}

export async function fetchJob(client: ApiClient, jobId: number): Promise<JobState> {
  const job = unwrap(
    await client.GET('/api/v1/print-jobs/{id}', { params: { path: { id: jobId } } }),
  );
  return { status: job.status, error: job.error, detail: job.detail };
}
