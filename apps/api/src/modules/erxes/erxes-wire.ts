/**
 * Everything Bto knows of erxes's GraphQL (ADR-0218 #8, ADR-0220): the queries it sends and how a
 * deal's answer is read. erxes has introspection switched off; the shapes marked «checked» were
 * tried against the company's erxes on 2026-11-19 (ADR-0220), the rest come from erxes's open
 * source. Two things keep a wrong guess from stopping the copy:
 *
 * - a query is a tree of fields, and a field erxes refuses («Cannot query field») is cut off and
 *   the query sent again (`ErxesClient.read`), so an unknown field costs that field only;
 * - a deal is kept whole as it came (`erxes_deals.raw`), and `readDeal` takes every value
 *   defensively: a missing or differently shaped value becomes null, never an exception.
 *
 * The first answers of every pipeline are logged and kept (`erxes_pipelines.first_pull`) to compare
 * with `erxes-wire.fixture.ts`. When erxes's shape differs, this is the only file to change.
 */

import { Decimal } from '@tugeel/shared/money';

/** A GraphQL selection: a leaf field, or a field with its own selection. */
export interface Selection {
  [field: string]: true | Selection;
}

/** One way to ask for something; the next one is tried when erxes does not know the first. */
export interface QueryShape {
  /** The root field, e.g. `salesBoards`. */
  root: string;
  /** Variable declarations, e.g. `$id: String!`. */
  declare?: string;
  /** The root field's arguments, e.g. `_id: $id`. */
  args?: string;
  selection: Selection;
}

const USER: Selection = {
  _id: true,
  email: true,
  username: true,
  details: { fullName: true, firstName: true, lastName: true, operatorPhone: true },
};

/**
 * The boards with their pipelines: the sales plugin's name first, the older «cards» one after.
 * Checked: `salesBoards` requires `type: "deal"` and answers nothing without it.
 */
export const BOARDS: readonly QueryShape[] = [
  {
    root: 'salesBoards',
    args: 'type: "deal"',
    selection: { _id: true, name: true, pipelines: { _id: true, name: true } },
  },
  {
    root: 'boards',
    args: 'type: "deal"',
    selection: { _id: true, name: true, pipelines: { _id: true, name: true } },
  },
];

export const USERS: readonly QueryShape[] = [
  { root: 'users', declare: '$perPage: Int', args: 'perPage: $perPage', selection: USER },
];

/**
 * Checked: `deals` leaves out archived deals unless it is told not to, and this company moves its
 * deals to the archive within hours. Every `deals` query carries this.
 */
const DEALS_ARGS =
  'pipelineId: $pipelineId, limit: $limit, skip: $skip, sortField: "createdAt", sortDirection: -1, noSkipArchive: true';

/** A page of a pipeline's deals, newest first: only what tells a new deal from a seen one. */
export const DEAL_PAGE: readonly QueryShape[] = [
  {
    root: 'deals',
    declare: '$pipelineId: String, $limit: Int, $skip: Int',
    args: DEALS_ARGS,
    selection: { _id: true, name: true, createdAt: true },
  },
];

/**
 * A page of the deals of a pipeline created between two moments, newest first (ADR-0220). Checked:
 * `createdStartDate` and `createdEndDate` filter by creation and are of type `Date` (a `String`
 * is refused); `startDate`/`endDate` filter something else. `_id`, `name` and `createdAt` are
 * checked; the rest is what the list shows and is cut when erxes does not give it on a list.
 */
export const DEAL_RANGE: readonly QueryShape[] = [
  {
    root: 'deals',
    declare:
      '$pipelineId: String, $limit: Int, $skip: Int, $createdStartDate: Date, $createdEndDate: Date',
    args: `${DEALS_ARGS}, createdStartDate: $createdStartDate, createdEndDate: $createdEndDate`,
    selection: {
      _id: true,
      name: true,
      number: true,
      createdAt: true,
      stageId: true,
      stage: { _id: true, name: true, pipelineId: true },
      userId: true,
      createdUser: USER,
      customers: { _id: true, code: true, firstName: true, lastName: true },
      companies: { _id: true, code: true, primaryName: true },
      productsData: true,
      amount: true,
    },
  },
];

const PARTY_PHONES: Selection = { primaryPhone: true, phones: true };

/** A whole deal. Every field here may be cut off by erxes; `readDeal` lives without any of them. */
export const DEAL_DETAIL: readonly QueryShape[] = [
  {
    root: 'dealDetail',
    declare: '$id: String!',
    args: '_id: $id',
    selection: {
      _id: true,
      name: true,
      number: true,
      description: true,
      status: true,
      priority: true,
      createdAt: true,
      modifiedAt: true,
      startDate: true,
      closeDate: true,
      stageChangedDate: true,
      stageId: true,
      boardId: true,
      stage: { _id: true, name: true, pipelineId: true },
      pipeline: { _id: true, name: true },
      userId: true,
      createdUser: USER,
      assignedUserIds: true,
      assignedUsers: USER,
      labelIds: true,
      labels: { _id: true, name: true, colorCode: true },
      tagIds: true,
      branchIds: true,
      departmentIds: true,
      customFieldsData: true,
      productsData: true,
      products: true,
      amount: true,
      unUsedAmount: true,
      customers: {
        _id: true,
        code: true,
        firstName: true,
        middleName: true,
        lastName: true,
        primaryEmail: true,
        registrationNumber: true,
        ...PARTY_PHONES,
      },
      companies: {
        _id: true,
        code: true,
        primaryName: true,
        names: true,
        primaryEmail: true,
        // Checked: erxes's Company has no `registrationNumber`; `taxNumber` holds the register.
        taxNumber: true,
        ...PARTY_PHONES,
      },
      attachments: { name: true, url: true, type: true, size: true },
    },
  },
];

/** The products of a deal's lines, for their codes, barcodes and base unit. Checked as it is. */
export const PRODUCTS: readonly QueryShape[] = [
  {
    root: 'products',
    declare: '$ids: [String], $perPage: Int',
    args: 'ids: $ids, perPage: $perPage',
    selection: { _id: true, name: true, code: true, barcodes: true, uom: true },
  },
];

/** The custom fields of a deal, for their labels. */
export const DEAL_FIELDS: readonly QueryShape[] = [
  {
    root: 'fields',
    args: 'contentType: "sales:deal"',
    selection: { _id: true, text: true, code: true, type: true },
  },
  {
    root: 'fields',
    args: 'contentType: "cards:deal"',
    selection: { _id: true, text: true, code: true, type: true },
  },
];

/** The sign-in: the only mutation Bto ever sends to erxes. */
export const LOGIN_DOCUMENT =
  'mutation login($email: String!, $password: String!) { login(email: $email, password: $password) }';

/** The cookie erxes keeps its session in. */
export const AUTH_COOKIE = 'auth-token';

export const GRAPHQL_PATH = '/gateway/graphql';

/** A query as text, one field a line, with the path of the field each line holds. */
export function renderQuery(shape: QueryShape): { document: string; paths: (string[] | null)[] } {
  const lines: string[] = [];
  const paths: (string[] | null)[] = [];
  const push = (line: string, path: string[] | null) => {
    lines.push(line);
    paths.push(path);
  };
  const walk = (selection: Selection, path: string[]) => {
    for (const [field, inner] of Object.entries(selection)) {
      const here = [...path, field];
      if (inner === true) {
        push(field, here);
      } else {
        push(`${field} {`, here);
        walk(inner, here);
        push('}', null);
      }
    }
  };
  push(`query bto${shape.declare ? `(${shape.declare})` : ''} {`, null);
  const root = `${shape.root}${shape.args ? `(${shape.args})` : ''}`;
  if (Object.keys(shape.selection).length === 0) {
    // A root of a scalar type (erxes's JSON) takes no selection.
    push(root, null);
  } else {
    push(`${root} {`, null);
    walk(shape.selection, []);
    push('}', null);
  }
  push('}', null);
  return { document: lines.join('\n'), paths };
}

/** The selection without one field; null when nothing would be left to ask for. */
export function withoutField(selection: Selection, path: readonly string[]): Selection | null {
  const [head, ...rest] = path;
  if (head === undefined) return selection;
  const next: Selection = {};
  for (const [field, inner] of Object.entries(selection)) {
    if (field !== head) {
      next[field] = inner;
    } else if (rest.length > 0 && inner !== true) {
      const kept = withoutField(inner, rest);
      if (kept) next[field] = kept;
    }
  }
  return Object.keys(next).length > 0 ? next : null;
}

/** Every path of a selection that ends in a field of this name. */
export function pathsOfField(selection: Selection, name: string, base: string[] = []): string[][] {
  const found: string[][] = [];
  for (const [field, inner] of Object.entries(selection)) {
    const here = [...base, field];
    if (field === name) found.push(here);
    if (inner !== true) found.push(...pathsOfField(inner, name, here));
  }
  return found;
}

// -------------------------------------------------------------------------------------------------
// Reading an answer

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objects = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** A non-empty trimmed text of a string or a number; null otherwise. */
export function textOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** erxes sends a date as an ISO text or as milliseconds. */
export function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = typeof value === 'string' && /^\d{11,14}$/.test(value);
  const date = new Date(numeric ? Number.parseInt(value, 10) : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A number as erxes wrote it, kept as text so nothing is rounded on the way. */
export function numberText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

/** Text without HTML tags: erxes's description is written in a rich editor. */
export function plainText(value: unknown): string | null {
  const text = textOf(value);
  if (text === null) return null;
  const plain = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain === '' ? null : plain;
}

/** Phones of a customer or a company: texts, or objects with a `phone`. */
function phonesOf(row: Json): string[] {
  const list = Array.isArray(row.phones) ? row.phones : [];
  const found = [
    textOf(row.primaryPhone),
    ...list.map((entry) => (isObject(entry) ? textOf(entry.phone) : textOf(entry))),
  ];
  return [...new Set(found.filter((phone): phone is string => phone !== null))];
}

export interface ErxesPerson {
  erxesId: string;
  email: string | null;
  username: string | null;
  fullName: string | null;
  phone: string | null;
}

export function readUser(value: unknown): ErxesPerson | null {
  if (!isObject(value)) return null;
  const erxesId = textOf(value._id);
  if (erxesId === null) return null;
  const details = isObject(value.details) ? value.details : {};
  const parts = [textOf(details.lastName), textOf(details.firstName)].filter(Boolean).join(' ');
  return {
    erxesId,
    email: textOf(value.email),
    username: textOf(value.username),
    fullName: textOf(details.fullName) ?? (parts === '' ? null : parts),
    phone: textOf(details.operatorPhone),
  };
}

/** What a person is called when nothing better is known. */
export function personName(person: ErxesPerson | null): string | null {
  return person ? (person.fullName ?? person.username ?? person.email) : null;
}

export interface ErxesParty {
  kind: 'COMPANY' | 'CUSTOMER';
  erxesId: string | null;
  code: string | null;
  name: string | null;
  regNo: string | null;
  phones: string[];
}

export interface ErxesProduct {
  erxesId: string;
  code: string | null;
  name: string | null;
  barcodes: string[];
  /** The product's own (base) unit in erxes. */
  uom: string | null;
}

export function readProduct(value: unknown): ErxesProduct | null {
  if (!isObject(value)) return null;
  const erxesId = textOf(value._id);
  if (erxesId === null) return null;
  const barcodes = Array.isArray(value.barcodes) ? value.barcodes : [];
  return {
    erxesId,
    code: textOf(value.code),
    name: textOf(value.name),
    barcodes: barcodes.map(textOf).filter((code): code is string => code !== null),
    uom: textOf(value.uom),
  };
}

export interface ErxesLine {
  erxesProductId: string | null;
  code: string | null;
  name: string | null;
  barcodes: string[];
  /** The unit the line was entered in. */
  uom: string | null;
  /** The product's own unit in erxes; null when erxes did not say. */
  productUom: string | null;
  quantity: string | null;
  unitPrice: string | null;
  discount: string | null;
  discountPercent: string | null;
  tax: string | null;
  amount: string | null;
}

export interface ErxesDealFacts {
  erxesId: string;
  name: string | null;
  number: string | null;
  description: string | null;
  createdAt: Date | null;
  startDate: Date | null;
  closeDate: Date | null;
  boardId: string | null;
  pipelineId: string | null;
  pipelineName: string | null;
  stageName: string | null;
  creatorId: string | null;
  creator: ErxesPerson | null;
  assigned: ErxesPerson[];
  labels: { name: string; color: string | null }[];
  customFields: { fieldId: string; value: string }[];
  /** Companies first: a wholesale deal is with the company. */
  parties: ErxesParty[];
  lines: ErxesLine[];
  attachments: { name: string | null; url: string; type: string | null }[];
}

/** A custom field's value as one line of text, whatever its type. */
function fieldValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map(fieldValue).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isObject(value)) return JSON.stringify(value);
  return textOf(value);
}

/**
 * A deal as erxes answered `dealDetail`, read for the copy and for the order panel. `products` is
 * what the `products` query said of the lines' products; a line also carries its product inside
 * `deal.products[].product` on the erxes versions that send it.
 */
export function readDeal(raw: unknown, products: readonly unknown[] = []): ErxesDealFacts | null {
  if (!isObject(raw)) return null;
  const erxesId = textOf(raw._id);
  if (erxesId === null) return null;

  const known = new Map<string, ErxesProduct>();
  for (const entry of products) {
    const product = readProduct(entry);
    if (product) known.set(product.erxesId, product);
  }
  const embedded = objects(raw.products);
  for (const entry of embedded) {
    const product = readProduct(entry.product);
    if (product && !known.has(product.erxesId)) known.set(product.erxesId, product);
  }
  // `productsData` is the lines as stored; `products` the same lines with their product inside.
  const stored = objects(raw.productsData);
  const lines = (stored.length > 0 ? stored : embedded).map((line): ErxesLine => {
    const erxesProductId = textOf(line.productId);
    const product =
      (erxesProductId === null ? undefined : known.get(erxesProductId)) ??
      readProduct(line.product) ??
      undefined;
    return {
      erxesProductId: erxesProductId ?? product?.erxesId ?? null,
      code: product?.code ?? null,
      name: product?.name ?? textOf(line.name),
      barcodes: product?.barcodes ?? [],
      uom: textOf(line.uom),
      productUom: product?.uom ?? null,
      quantity: numberText(line.quantity),
      unitPrice: numberText(line.unitPrice),
      discount: numberText(line.discount),
      discountPercent: numberText(line.discountPercent),
      tax: numberText(line.tax),
      amount: numberText(line.amount),
    };
  });

  const party = (kind: ErxesParty['kind'], row: Json): ErxesParty => {
    const names = Array.isArray(row.names) ? row.names.map(textOf).filter(Boolean) : [];
    const person = [textOf(row.lastName), textOf(row.firstName)].filter(Boolean).join(' ');
    return {
      kind,
      erxesId: textOf(row._id),
      code: textOf(row.code),
      name:
        kind === 'COMPANY'
          ? (textOf(row.primaryName) ?? names[0] ?? null)
          : person === ''
            ? null
            : person,
      regNo: textOf(row.registrationNumber) ?? textOf(row.taxNumber),
      phones: phonesOf(row),
    };
  };

  const stage = isObject(raw.stage) ? raw.stage : {};
  const pipeline = isObject(raw.pipeline) ? raw.pipeline : {};
  const creator = readUser(raw.createdUser);
  return {
    erxesId,
    name: textOf(raw.name),
    number: textOf(raw.number),
    description: plainText(raw.description),
    createdAt: dateOf(raw.createdAt),
    startDate: dateOf(raw.startDate),
    closeDate: dateOf(raw.closeDate),
    boardId: textOf(raw.boardId),
    pipelineId: textOf(pipeline._id) ?? textOf(stage.pipelineId),
    pipelineName: textOf(pipeline.name),
    stageName: textOf(stage.name),
    creatorId: textOf(raw.userId) ?? creator?.erxesId ?? null,
    creator,
    assigned: objects(raw.assignedUsers)
      .map(readUser)
      .filter((user): user is ErxesPerson => user !== null),
    labels: objects(raw.labels).flatMap((label) => {
      const name = textOf(label.name);
      return name === null ? [] : [{ name, color: textOf(label.colorCode) }];
    }),
    customFields: objects(raw.customFieldsData).flatMap((entry) => {
      const fieldId = textOf(entry.field);
      const value = fieldValue(entry.value) ?? fieldValue(entry.stringValue);
      return fieldId === null || value === null ? [] : [{ fieldId, value }];
    }),
    parties: [
      ...objects(raw.companies).map((row) => party('COMPANY', row)),
      ...objects(raw.customers).map((row) => party('CUSTOMER', row)),
    ],
    lines,
    attachments: objects(raw.attachments).flatMap((file) => {
      const url = textOf(file.url);
      return url === null ? [] : [{ name: textOf(file.name), url, type: textOf(file.type) }];
    }),
  };
}

/**
 * A deal's total as erxes counts it: its `amount` (`{ MNT: 36400 }`, or a plain number) when it
 * says one, else the sum of its lines' `amount`; null when neither is there.
 */
export function dealTotal(raw: unknown): string | null {
  if (!isObject(raw)) return null;
  const said = isObject(raw.amount)
    ? (numberText(raw.amount.MNT) ?? numberText(Object.values(raw.amount)[0]))
    : numberText(raw.amount);
  if (said !== null) return said;
  const amounts = objects(raw.productsData).map((line) => numberText(line.amount));
  if (amounts.length === 0 || amounts.some((amount) => amount === null)) return null;
  return amounts.reduce((sum, amount) => sum.plus(amount ?? '0'), new Decimal(0)).toString();
}

/** The ids of the products a deal's lines name. */
export function productIdsOf(raw: unknown): string[] {
  if (!isObject(raw)) return [];
  const ids = [...objects(raw.productsData), ...objects(raw.products)].map((line) =>
    textOf(line.productId),
  );
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/** Field id → its label, from the `fields` answer. */
export function fieldLabelsOf(fields: readonly unknown[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const field of objects(fields)) {
    const id = textOf(field._id);
    const label = textOf(field.text) ?? textOf(field.code);
    if (id !== null && label !== null) labels[id] = label;
  }
  return labels;
}

/** Where a person opens the deal in erxes. */
export function dealUrl(baseUrl: string, deal: ErxesDealFacts): string {
  const query = new URLSearchParams();
  if (deal.boardId) query.set('id', deal.boardId);
  if (deal.pipelineId) query.set('pipelineId', deal.pipelineId);
  query.set('itemId', deal.erxesId);
  return `${baseUrl}/deal/board?${query.toString()}`;
}

/** An attachment's address: erxes keeps either a whole address or the key of a stored file. */
export function attachmentUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}/gateway/read-file?key=${encodeURIComponent(url)}`;
}

/** A board whose deals are never copied: Kharkhorin runs its own installation (ADR-0218 #3). */
export function isBlockedBoard(name: string | null): boolean {
  const key = (name ?? '').toLowerCase().replace(/\s+/g, '');
  return key.includes('хархорин') || key.includes('kharkhorin') || key.includes('harhorin');
}

// -------------------------------------------------------------------------------------------------
// Erkhet's stock through erxes (ADR-0221)
//
// erxes's «syncerkhet» plugin answers `erkhetRemainders` by asking Erkhet once for a list of
// products, at the locations the pipeline's `remainderConfig` entry names. These shapes come from
// the old ERP's working code (2026-10-22), not from a check of Bto's: what erxes refuses is seen.

/** The account of goods in Erkhet: only `remainderConfig` entries of this account are stock. */
export const STOCK_ACCOUNT = '150101';

/** Products a `erkhetRemainders` call asks for at most: 200 got no answer from Erkhet. */
export const REMAINDER_BATCH = 50;

/**
 * `configsGetValue` answers erxes's JSON; an erxes whose config is an object type takes the second
 * shape.
 */
export const REMAINDER_CONFIG: readonly QueryShape[] = [
  { root: 'configsGetValue', args: 'code: "remainderConfig"', selection: {} },
  {
    root: 'configsGetValue',
    args: 'code: "remainderConfig"',
    selection: { _id: true, code: true, value: true },
  },
];

/** A page of erxes's active products: the old ERP read pages of 1000. */
export const PRODUCT_PAGE: readonly QueryShape[] = [
  {
    root: 'products',
    declare: '$perPage: Int, $page: Int',
    args: 'status: "active", perPage: $perPage, page: $page',
    selection: { _id: true, code: true, name: true, barcodes: true, uom: true },
  },
];

/** Erkhet's balances of a list of products at the locations of one pipeline's config. */
export const ERKHET_REMAINDERS: readonly QueryShape[] = [
  {
    root: 'erkhetRemainders',
    declare: '$productIds: [String], $pipelineId: String',
    args: 'productIds: $productIds, stageId: "", pipelineId: $pipelineId',
    selection: { _id: true, remainder: true, remainders: true },
  },
  {
    root: 'erkhetRemainders',
    declare: '$productIds: [String], $pipelineId: String',
    args: 'productIds: $productIds, stageId: "", pipelineId: $pipelineId',
    selection: { _id: true, remainder: true, remainders: { location: true, remainder: true } },
  },
];

/**
 * Erkhet's location names as its stock report listed them on 2026-10-22: a label for a code only
 * while Bto knows no other; the owner links each location to a warehouse by hand.
 */
export const ERKHET_LOCATION_NAMES: Readonly<Record<string, string>> = {
  '01': 'Бөөний агуулах',
  '02': 'Ус ундаа архи пиво',
  '03': 'Заал',
  '04': 'Хархорин заал',
  '05': 'Хархорин агуулах',
  '08': 'Заалны архи',
  '10': 'Агуулахын хөргүүр',
  '11': 'Жижиглэн барааны агуулах',
  '12': 'Гэрээт компаний агуулах',
  '13': 'Гэр ахуйн барааны агуулах',
  '14': 'Discrepancy Control',
  '17': 'Аяны барааны гадна лангуу',
};

/** One entry of `remainderConfig`: a pipeline, its Erkhet account and the locations it reads. */
export interface RemainderConfig {
  pipelineId: string;
  account: string | null;
  locations: string[];
}

/** One call of a run: this pipeline is asked, and these locations are taken from its answer. */
export interface RemainderStep {
  pipelineId: string;
  locations: string[];
}

/** A location code as Erkhet writes it: «01», never «1» or « 01 ». */
export function locationOf(value: unknown): string | null {
  const text = textOf(value);
  return text !== null && /^[0-9A-Za-z_-]{1,16}$/.test(text) ? text : null;
}

/** JSON erxes may send as text. */
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * The entries of `remainderConfig`: pipeline id → `{ account, location: "01,02" }`, as erxes's JSON,
 * inside `value`, or as text of either.
 */
export function readRemainderConfig(raw: unknown): RemainderConfig[] {
  let value = parsed(raw);
  if (isObject(value) && 'value' in value) value = parsed(value.value);
  if (!isObject(value)) return [];
  const found: RemainderConfig[] = [];
  for (const [pipelineId, entry] of Object.entries(value)) {
    const config = parsed(entry);
    if (!isObject(config)) continue;
    const said = Array.isArray(config.location)
      ? config.location
      : (textOf(config.location) ?? '').split(',');
    const locations = [
      ...new Set(said.map(locationOf).filter((code): code is string => code !== null)),
    ].sort();
    found.push({ pipelineId, account: textOf(config.account), locations });
  }
  return found;
}

/**
 * The fewest pipelines that cover every stock location (the old ERP's greedy plan): no one pipeline
 * reads them all. Each location is taken from the first step that covers it, so it is read once.
 */
export function planRemainders(configs: readonly RemainderConfig[]): RemainderStep[] {
  const stock = configs.filter(
    (config) => config.account === STOCK_ACCOUNT && config.locations.length > 0,
  );
  const need = new Set(stock.flatMap((config) => config.locations));
  const steps: RemainderStep[] = [];
  while (need.size > 0) {
    let best: { config: RemainderConfig; takes: string[] } | null = null;
    for (const config of stock) {
      const takes = config.locations.filter((code) => need.has(code));
      if (takes.length > (best?.takes.length ?? 0)) best = { config, takes };
    }
    if (!best) break;
    steps.push({ pipelineId: best.config.pipelineId, locations: best.takes });
    for (const code of best.takes) need.delete(code);
  }
  return steps;
}

/** One product's balances at Erkhet's locations, as `erkhetRemainders` answered. */
export interface ErkhetRemainder {
  erxesId: string;
  /** location code → the quantity as Erkhet wrote it, in erxes's unit of the product. */
  byLocation: Map<string, string>;
}

/**
 * An `erkhetRemainders` answer: per product `remainders`, a list of `{ location, remainder }` (or
 * the same as JSON text). A row without a usable location or number is left out; a location named
 * twice is summed.
 */
export function readRemainders(raw: unknown): ErkhetRemainder[] {
  const found: ErkhetRemainder[] = [];
  for (const row of objects(raw)) {
    const erxesId = textOf(row._id);
    if (erxesId === null) continue;
    const byLocation = new Map<string, string>();
    for (const entry of objects(parsed(row.remainders))) {
      const location = locationOf(entry.location ?? entry.locationCode ?? entry.code);
      const quantity = numberText(entry.remainder ?? entry.quantity);
      if (location === null || quantity === null) continue;
      const before = byLocation.get(location);
      byLocation.set(
        location,
        before === undefined ? quantity : new Decimal(before).plus(quantity).toString(),
      );
    }
    found.push({ erxesId, byLocation });
  }
  return found;
}

// ------------------------------------------------------------------------------------------------
// A product's category and price group in erxes (ADR-0223): «Эрхэт тулгалт» adds Erkhet's items the
// way erxes files them. Every shape and field below was checked read-only against the company's
// erxes on 2026-11-19 (13,142 active products, 101 categories, 294 pricing plans, 112 product tags).

/** A page of erxes's active products with what files and prices them. */
export const PRODUCT_FACTS_PAGE: readonly QueryShape[] = [
  {
    root: 'products',
    declare: '$perPage: Int, $page: Int',
    args: 'status: "active", perPage: $perPage, page: $page',
    selection: { _id: true, code: true, barcodes: true, categoryId: true, tagIds: true },
  },
];

/** erxes's product categories; a name is numbered like «101 Дарс виски» (ADR-0098). */
export const PRODUCT_CATEGORIES: readonly QueryShape[] = [
  {
    root: 'productCategories',
    selection: { _id: true, name: true, code: true, parentId: true },
  },
];

/** erxes's product tags; a pricing plan of a tag takes its child tags too. */
export const PRODUCT_TAGS: readonly QueryShape[] = [
  {
    root: 'tags',
    args: 'type: "core:product", perPage: 1000',
    selection: { _id: true, name: true, parentId: true },
  },
];

/** The tills of erxes: which branch and department a plan must name to price a till. */
export const POS_LIST: readonly QueryShape[] = [
  { root: 'posList', selection: { _id: true, name: true, branchId: true, departmentId: true } },
];

/** Pricing plans: 294 on 2026-11-19, so one page of 1000 holds them. */
export const PRICING_PLANS: readonly QueryShape[] = [
  {
    root: 'pricingPlans',
    args: 'perPage: 1000',
    selection: {
      _id: true,
      name: true,
      status: true,
      isPriority: true,
      applyType: true,
      products: true,
      productsExcluded: true,
      tags: true,
      tagsExcluded: true,
      branchIds: true,
      departmentIds: true,
      pipelineId: true,
    },
  },
];

/**
 * The supermarket's till in erxes's `posList` (the till «Мөрөн-P.O.S» prices for, ADR-0207): its
 * branch and department choose the plans Bto's price profiles were copied from.
 */
export const ERXES_TILL_POS = 'Бүтэн Оргил ХХК';

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(textOf).filter((text): text is string => text !== null) : [];

export interface ErxesFactProduct {
  erxesId: string;
  code: string | null;
  barcodes: string[];
  categoryId: string | null;
  tagIds: string[];
}

export function readFactProduct(value: unknown): ErxesFactProduct | null {
  if (!isObject(value)) return null;
  const erxesId = textOf(value._id);
  if (erxesId === null) return null;
  return {
    erxesId,
    code: textOf(value.code),
    barcodes: texts(value.barcodes),
    categoryId: textOf(value.categoryId),
    tagIds: texts(value.tagIds),
  };
}

export interface ErxesCategory {
  erxesId: string;
  name: string | null;
}

export function readCategories(raw: unknown): ErxesCategory[] {
  return objects(raw).flatMap((row) => {
    const erxesId = textOf(row._id);
    return erxesId === null ? [] : [{ erxesId, name: textOf(row.name) }];
  });
}

export interface ErxesTag {
  erxesId: string;
  parentId: string | null;
}

export function readTags(raw: unknown): ErxesTag[] {
  return objects(raw).flatMap((row) => {
    const erxesId = textOf(row._id);
    return erxesId === null ? [] : [{ erxesId, parentId: textOf(row.parentId) }];
  });
}

export interface ErxesPos {
  name: string | null;
  branchId: string | null;
  departmentId: string | null;
}

export function readPosList(raw: unknown): ErxesPos[] {
  return objects(raw).map((row) => ({
    name: textOf(row.name),
    branchId: textOf(row.branchId),
    departmentId: textOf(row.departmentId),
  }));
}

export interface ErxesPlan {
  erxesId: string;
  name: string | null;
  active: boolean;
  isPriority: boolean;
  /** `tag`, `product`, `category`, `bundle`, `segment`, `vendor`. */
  applyType: string | null;
  products: string[];
  productsExcluded: string[];
  tags: string[];
  tagsExcluded: string[];
  branchIds: string[];
  departmentIds: string[];
  pipelineId: string | null;
}

export function readPlans(raw: unknown): ErxesPlan[] {
  return objects(raw).flatMap((row) => {
    const erxesId = textOf(row._id);
    if (erxesId === null) return [];
    return [
      {
        erxesId,
        name: textOf(row.name),
        active: textOf(row.status) === 'active',
        isPriority: row.isPriority === true,
        applyType: textOf(row.applyType),
        products: texts(row.products),
        productsExcluded: texts(row.productsExcluded),
        tags: texts(row.tags),
        tagsExcluded: texts(row.tagsExcluded),
        branchIds: texts(row.branchIds),
        departmentIds: texts(row.departmentIds),
        pipelineId: textOf(row.pipelineId),
      },
    ];
  });
}
