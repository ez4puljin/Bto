// The pure rules of carrying the old system's expiry records into Bto (ADR-0172 #12,
// docs/modules/expiry.md §5). No I/O here, so `rules.test.mjs` proves them on made-up rows.
import {
  EXPIRY_LIABILITY_NOTE_MAX,
  EXPIRY_NAME_MAX,
  EXPIRY_NOTE_MAX,
  EXPIRY_QTY_PATTERN,
} from '@tugeel/shared/expiry';
import { isIsoDate } from '@tugeel/shared/time';

/** Stands for an author the old page left empty: the carry route needs at least one character. */
export const OLD_SYSTEM_NAME = 'Хуучин систем';

const STATUSES = new Map([
  ['review', 'REVIEW'],
  ['city_return', 'CITY_RETURN'],
  ['internal_sale', 'INTERNAL_SALE'],
  ['archived', 'ARCHIVED'],
]);
const LIABILITIES = new Map([
  ['none', 'NONE'],
  ['specific', 'SPECIFIC'],
  ['all_staff', 'ALL_STAFF'],
]);
const CHANGE_KINDS = new Map([
  ['create', 'CREATE'],
  ['update', 'UPDATE'],
]);

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}:\d{2})?$/;

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
const isOldId = (value) => Number.isSafeInteger(value) && value > 0;

/** An old JSON number as a quantity string with up to 3 decimals; null when negative or not a number. */
export function quantityText(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const text = value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return EXPIRY_QTY_PATTERN.test(text) ? text : null;
}

/** The old system's naive UTC text with its zone, as the carry route requires; null when unreadable. */
export function toInstant(value) {
  const match = INSTANT.exec(trimmed(value));
  if (!match) return null;
  const instant = `${match[1]}${match[2] ?? 'Z'}`;
  return Number.isNaN(Date.parse(instant)) ? null : instant;
}

/** The old master's own code rule (`norm_code`): a code read from a sheet as a number loses its `.0`. */
export function normalizeCode(value) {
  const text = String(value ?? '').trim();
  if (['nan', 'none'].includes(text.toLowerCase())) return '';
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/** The old product's comma-joined barcodes, each normalised like a code. */
export function splitOldBarcodes(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map(normalizeCode)
        .filter(Boolean),
    ),
  ];
}

/** Cuts by code points, as the database and the route count them, so no emoji is split in two. */
function fit(text, max) {
  const characters = Array.from(text);
  if (characters.length <= max) return { text, truncated: false };
  return { text: characters.slice(0, max).join('').trimEnd(), truncated: true };
}

const authorName = (username) => fit(trimmed(username), EXPIRY_NAME_MAX).text || OLD_SYSTEM_NAME;

/** The dumped lookups by what a row names: a role's slug, a person's old id. */
export function indexLookups(roles, users) {
  return {
    roles: new Map(roles.map((role) => [role.value, trimmed(role.label) || role.value])),
    users: new Map(
      users.map((user) => [user.id, trimmed(user.nickname) || trimmed(user.username)]),
    ),
  };
}

/**
 * Who a row names, in words, as the old page showed it. Only `specific` names anyone there. The old
 * lookups leave out admin and inactive staff, so a role falls back to its slug and a person to `#id`.
 */
export function oldLiableLabels(row, lookups) {
  if (row.liability_type !== 'specific') return [];
  const roles = (row.liability_role_ids ?? [])
    .map(trimmed)
    .filter(Boolean)
    .map((slug) => lookups.roles.get(slug) ?? slug);
  const people = (row.liability_user_ids ?? []).map((id) => lookups.users.get(id) || `#${id}`);
  return [...roles, ...people];
}

function liabilityNoteOf(row, lookups) {
  const labels = oldLiableLabels(row, lookups);
  const parts = [trimmed(row.liability_note)];
  if (labels.length > 0) parts.push(`Хуучин: ${labels.join(', ')}`);
  return fit(parts.filter(Boolean).join(' · '), EXPIRY_LIABILITY_NOTE_MAX);
}

/** One old history row as the carry route's change; null when it cannot be sent as it stands. */
export function mapChange(change) {
  const kind = CHANGE_KINDS.get(change?.kind);
  const quantities = {
    qtyFloorOld: quantityText(change?.qty_floor_old),
    qtyFloorNew: quantityText(change?.qty_floor_new),
    qtyWarehouseOld: quantityText(change?.qty_warehouse_old),
    qtyWarehouseNew: quantityText(change?.qty_warehouse_new),
  };
  const changedAt = toInstant(change?.changed_at);
  if (!kind || !isOldId(change?.id) || !changedAt) return null;
  if (Object.values(quantities).includes(null)) return null;
  return {
    legacyId: change.id,
    kind,
    ...quantities,
    changedAt,
    changedByName: authorName(change.changed_by_username),
  };
}

/**
 * One old row and its history as the body of `POST /expiry/items/carry`, without `productId`, which
 * the tool finds afterwards: `{ body, noteTruncated, liabilityNoteTruncated, historyLeftOut }`, or
 * `{ leftOut: reason }` when the record cannot be sent. A history row that cannot be sent is dropped
 * and counted, and the record still comes over: one lost change is less than one lost record.
 */
export function mapRecord(row, history, lookups) {
  if (!isOldId(row?.id)) return { leftOut: 'no usable old id' };
  const status = STATUSES.get(row.status);
  if (!status) return { leftOut: 'unknown status' };
  const liabilityType = LIABILITIES.get(row.liability_type);
  if (!liabilityType) return { leftOut: 'unknown liability type' };
  if (typeof row.expiration_date !== 'string' || !isIsoDate(row.expiration_date)) {
    return { leftOut: 'no usable expiry date' };
  }
  const qtyFloor = quantityText(row.qty_floor);
  const qtyWarehouse = quantityText(row.qty_warehouse);
  if (qtyFloor === null || qtyWarehouse === null) return { leftOut: 'unusable quantity' };
  const createdAt = toInstant(row.created_at);
  if (!createdAt) return { leftOut: 'no usable creation time' };

  // The route itself takes createdAt for an archived row without a time, so none is invented here.
  const archive = {};
  if (status === 'ARCHIVED') {
    if (row.archived_at) {
      archive.archivedAt = toInstant(row.archived_at);
      if (!archive.archivedAt) return { leftOut: 'no usable archive time' };
    }
    const archivedByName = fit(trimmed(row.archived_by_username), EXPIRY_NAME_MAX).text;
    if (archivedByName) archive.archivedByName = archivedByName;
  }

  const note = fit(trimmed(row.notes), EXPIRY_NOTE_MAX);
  const liabilityNote = liabilityNoteOf(row, lookups);
  const changes = Array.isArray(history) ? history : [];
  const carried = changes.map(mapChange).filter(Boolean);

  return {
    body: {
      legacyId: row.id,
      expiryDate: row.expiration_date,
      qtyFloor,
      qtyWarehouse,
      status,
      liabilityType,
      liabilityRoleIds: [],
      liabilityUserIds: [],
      ...(liabilityNote.text ? { liabilityNote: liabilityNote.text } : {}),
      ...(note.text ? { note: note.text } : {}),
      createdAt,
      createdByName: authorName(row.created_by_username),
      ...archive,
      history: carried,
    },
    noteTruncated: note.truncated,
    liabilityNoteTruncated: liabilityNote.truncated,
    historyLeftOut: changes.length - carried.length,
  };
}

/** Remembers each code's answer, a «not found» too; a lookup that threw is asked again. */
export function cachedPerCode(find) {
  const answers = new Map();
  return async (code) => {
    if (!answers.has(code)) answers.set(code, await find(code));
    return answers.get(code);
  };
}

/** The Bto product of an old row: by code as a SKU, by code as a barcode, then by each old barcode. */
export async function findProductId(row, { bySku, byBarcode }) {
  const code = normalizeCode(row.product_code);
  if (code) {
    const found = (await bySku(code)) ?? (await byBarcode(code));
    if (found !== null) return found;
  }
  for (const barcode of splitOldBarcodes(row.product_barcode)) {
    const found = await byBarcode(barcode);
    if (found !== null) return found;
  }
  return null;
}

/**
 * What a failed call may print: the status and the problem's stable code. Never the error's message,
 * since a lookup's path holds the product code and a parser's message quotes the answer.
 */
export function failureText(error) {
  if (error?.status) {
    return `HTTP ${error.status}${error.problem?.code ? ` ${error.problem.code}` : ''}`;
  }
  const signIn = /^sign-in failed: HTTP \d+$/.test(error?.message ?? '');
  return signIn ? error.message : 'no usable answer from the api';
}

/** The refused fields of a 422 as `path/constraint`: the api never echoes a value in these. */
export function failureFields(error) {
  const fields = error?.problem?.errors;
  return Array.isArray(fields) ? fields.map((field) => `${field.path}/${field.constraint}`) : [];
}
