// Every shop product's thumbnail kept on the phone (the owner, 2026-10-17): the list comes from
// GET /sales-rep/thumbs and each picture goes into expo-image's disk cache. The URLs never change,
// so a kept picture is never downloaded again.

/** At most this often the phone asks again, for new products' pictures. */
export const THUMBS_EVERY_MS = 6 * 60 * 60 * 1000;

/** Thumbnails downloaded side by side. */
export const THUMBS_AT_ONCE = 6;

/** A run that lost more than this share of its pictures (the Wi-Fi dropped) is tried again. */
export const THUMBS_LOSS_LIMIT = 0.1;

/** The storage key of when this server's thumbnails were last kept. */
export const thumbsKey = (server: string) => `bto.thumbs.v1:${server}`;

/** When the thumbnails were last kept, from storage: 0 for nothing (or anything else) stored. */
export function checkedAtFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Whether it is time to ask again; a clock set back counts as time. */
export function thumbsDue(checkedAt: number, now: number): boolean {
  return now - checkedAt >= THUMBS_EVERY_MS || now < checkedAt;
}

/** Whether a run kept enough of its pictures to wait for the next interval. */
export function thumbsKept(total: number, failed: number): boolean {
  return failed <= total * THUMBS_LOSS_LIMIT;
}

/** The list in runs of `size`, in order. */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
