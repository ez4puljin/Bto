/**
 * Features the owner put on hold (2026-10-30): the shelves (bins) stay in the data model and the
 * API, but every screen shows them as «Тун удахгүй» — no shelf is typed, scanned or listed until
 * the shelf work resumes. Tests run with the shelves on (`src/test/setup.ts`).
 */
export const BINS_SOON = true;

/**
 * The owner (2026-10-31): a product's page carries no e-Barimt section to fill; the codes stay in
 * the data and the accountant fills them by category on the readiness page.
 */
export const EBARIMT_PER_PRODUCT = false;

/**
 * The «Шинэ өөрчлөлт» dialog on sign-in (ADR-0251). Tests run with it off (`src/test/setup.ts`)
 * so that it never covers the page a test reads; its own test renders it directly.
 */
export const NEWS_DIALOG = true;
