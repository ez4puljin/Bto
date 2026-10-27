import {
  EDGE_API_PREFIX,
  EDGE_DEVICE_HEADER,
  type EdgeBarcodeHit,
  type EdgeCartLine,
  type EdgeCustomer,
  type EdgeDeviceInfo,
  type EdgeDiscardParkedRequest,
  type EdgeEbarimtQueue,
  type EdgeEbarimtResolveRequest,
  type EdgeEbarimtSendDataRequest,
  type EdgeHealth,
  type EdgeLoginRequest,
  type EdgeLoginResponse,
  type EdgePairRequest,
  type EdgePairResponse,
  type EdgeParkedBasket,
  type EdgeParkRequest,
  type EdgePrintableReceipt,
  type EdgeProductHit,
  type EdgeQuickGroup,
  type EdgeQuoteRequest,
  type EdgeQuoteResponse,
  type EdgeReceipt,
  type EdgeReturnRequest,
  type EdgeReturnSale,
  type EdgeSaleRequest,
  type EdgeSession,
  type EdgeShiftCloseRequest,
  type EdgeShiftOpenRequest,
  type EdgeShiftSummary,
  type EdgeSupervisor,
  type EdgeTaxpayer,
  type EdgeVoidRequest,
  type EdgeVoidResponse,
} from '@tugeel/shared/pos';

/** The bound browser's credential (ADR-0067): kept across restarts of the till PC. */
export const DEVICE_STORAGE_KEY = 'bto.kiosk.device.v1';
/** The cashier's edge token: this tab only, gone when the browser closes. */
export const SESSION_STORAGE_KEY = 'bto.kiosk.session.v1';
/** The cashier of that session, so an expired one returns to their PIN pad. */
export const CASHIER_STORAGE_KEY = 'bto.kiosk.cashier.v1';

/** Why the kiosk went back a step on its own: the PIN screen or the pairing screen says so. */
export type KioskNotice = 'POS_SESSION_EXPIRED' | 'POS_DEVICE_UNKNOWN';

/** An RFC 9457 problem from the edge, or `NETWORK` (status 0) when the edge did not answer. */
export interface EdgeProblem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  params?: Record<string, unknown>;
}

export class EdgeError extends Error {
  readonly problem: EdgeProblem;

  constructor(problem: EdgeProblem) {
    super(problem.code);
    this.name = 'EdgeError';
    this.problem = problem;
  }
}

export function edgeProblemOf(error: unknown): EdgeProblem {
  if (error instanceof EdgeError) return error.problem;
  return { status: 0, code: 'INTERNAL_ERROR' };
}

export interface KioskCredentialsState {
  deviceToken: string | null;
  sessionToken: string | null;
  /** The cashier who signed in last on this tab, so an expired session returns to their PIN. */
  lastCashierId: number | null;
  notice: KioskNotice | null;
  /** Grows on every sign-in and sign-out: queries of one session never serve the next. */
  epoch: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface KioskStorage {
  local: StorageLike | null;
  session: StorageLike | null;
}

function browserStorage(): KioskStorage {
  const pick = (open: () => Storage) => {
    try {
      return open();
    } catch {
      return null;
    }
  };
  return { local: pick(() => window.localStorage), session: pick(() => window.sessionStorage) };
}

function read(store: StorageLike | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: StorageLike | null, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // A blocked storage keeps the value for this page only.
  }
}

/**
 * The till's two credentials: the device token from pairing (localStorage) and the cashier's
 * session token from the PIN (sessionStorage). A small external store for useSyncExternalStore.
 */
export class KioskCredentials {
  private state: KioskCredentialsState;
  private readonly storage: KioskStorage;
  private readonly listeners = new Set<() => void>();

  constructor(storage: KioskStorage = browserStorage()) {
    this.storage = storage;
    const deviceToken = read(storage.local, DEVICE_STORAGE_KEY);
    const cashier = Number.parseInt(read(storage.session, CASHIER_STORAGE_KEY) ?? '', 10);
    this.state = {
      deviceToken,
      sessionToken: deviceToken ? read(storage.session, SESSION_STORAGE_KEY) : null,
      lastCashierId: Number.isSafeInteger(cashier) ? cashier : null,
      notice: null,
      epoch: 0,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): KioskCredentialsState => this.state;

  paired(deviceToken: string): void {
    write(this.storage.local, DEVICE_STORAGE_KEY, deviceToken);
    write(this.storage.session, SESSION_STORAGE_KEY, null);
    write(this.storage.session, CASHIER_STORAGE_KEY, null);
    this.set({ deviceToken, sessionToken: null, lastCashierId: null, notice: null });
  }

  signedIn(sessionToken: string, cashierId: number): void {
    write(this.storage.session, SESSION_STORAGE_KEY, sessionToken);
    write(this.storage.session, CASHIER_STORAGE_KEY, String(cashierId));
    this.set({ sessionToken, lastCashierId: cashierId, notice: null });
  }

  /** Back to the PIN screen; `notice` says why when the kiosk did it on its own. */
  signedOut(notice: KioskNotice | null = null): void {
    write(this.storage.session, SESSION_STORAGE_KEY, null);
    if (!notice) write(this.storage.session, CASHIER_STORAGE_KEY, null);
    this.set({
      sessionToken: null,
      notice,
      lastCashierId: notice ? this.state.lastCashierId : null,
    });
  }

  /** Back to pairing: the edge no longer knows this browser. */
  unpaired(notice: KioskNotice | null = null): void {
    write(this.storage.local, DEVICE_STORAGE_KEY, null);
    write(this.storage.session, SESSION_STORAGE_KEY, null);
    write(this.storage.session, CASHIER_STORAGE_KEY, null);
    this.set({ deviceToken: null, sessionToken: null, lastCashierId: null, notice });
  }

  clearNotice(): void {
    if (this.state.notice !== null) this.set({ notice: null }, false);
  }

  private set(change: Partial<KioskCredentialsState>, bump = true): void {
    this.state = { ...this.state, ...change, epoch: this.state.epoch + (bump ? 1 : 0) };
    for (const listener of this.listeners) listener();
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface EdgeClientOptions {
  /** Origin of the edge; the page's own origin unless given (tests). */
  baseUrl?: string;
  fetch?: FetchLike;
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The kiosk's calls to its store edge (`/edge/v1`, ADR-0067). Every call after pairing sends the
 * device token; after the PIN also the cashier's bearer token. An expired session sends the kiosk
 * back to the PIN screen and an unknown device back to pairing, wherever the call was made.
 */
export class EdgeClient {
  private readonly credentials: KioskCredentials;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(credentials: KioskCredentials, options: EdgeClientOptions = {}) {
    this.credentials = credentials;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch;
  }

  health(signal?: AbortSignal) {
    return this.request<EdgeHealth>('GET', '/health', { signal });
  }

  pair(body: EdgePairRequest) {
    return this.request<EdgePairResponse>('POST', '/pair', { body });
  }

  device(signal?: AbortSignal) {
    return this.request<EdgeDeviceInfo>('GET', '/device', { signal });
  }

  login(body: EdgeLoginRequest) {
    return this.request<EdgeLoginResponse>('POST', '/auth/pin', { body });
  }

  logout() {
    return this.request<undefined>('POST', '/auth/logout');
  }

  session(signal?: AbortSignal) {
    return this.request<EdgeSession>('GET', '/session', { signal });
  }

  openShift(body: EdgeShiftOpenRequest) {
    return this.request<EdgeShiftSummary>('POST', '/shifts/open', { body });
  }

  closeShift(body: EdgeShiftCloseRequest) {
    return this.request<EdgeShiftSummary>('POST', '/shifts/close', { body });
  }

  searchProducts(q: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ q }).toString();
    return this.request<EdgeProductHit[]>('GET', `/products/search?${query}`, { signal });
  }

  barcode(code: string) {
    return this.request<EdgeBarcodeHit>('GET', `/products/barcode/${encodeURIComponent(code)}`);
  }

  quote(body: EdgeQuoteRequest, signal?: AbortSignal) {
    return this.request<EdgeQuoteResponse>('POST', '/quote', { body, signal });
  }

  sale(body: EdgeSaleRequest) {
    return this.request<EdgePrintableReceipt>('POST', '/sales', { body });
  }

  /** ADR-0109: the customers a sale on credit may charge (the edge's feed, offline too). */
  customers(q: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ q }).toString();
    return this.request<EdgeCustomer[]>('GET', `/customers?${query}`, { signal });
  }

  customer(id: number, signal?: AbortSignal) {
    return this.request<EdgeCustomer>('GET', `/customers/${id}`, { signal });
  }

  recentSales(signal?: AbortSignal) {
    return this.request<EdgeReceipt[]>('GET', '/sales/recent', { signal });
  }

  quickButtons(signal?: AbortSignal) {
    return this.request<EdgeQuickGroup[]>('GET', '/quick-buttons', { signal });
  }

  supervisors(signal?: AbortSignal) {
    return this.request<EdgeSupervisor[]>('GET', '/supervisors', { signal });
  }

  void(body: EdgeVoidRequest) {
    return this.request<EdgeVoidResponse>('POST', '/voids', { body });
  }

  parked(signal?: AbortSignal) {
    return this.request<EdgeParkedBasket[]>('GET', '/parked', { signal });
  }

  park(body: EdgeParkRequest) {
    return this.request<EdgeParkedBasket>('POST', '/parked', { body });
  }

  resumeParked(clientId: string) {
    return this.request<EdgeCartLine[]>('POST', `/parked/${clientId}/resume`);
  }

  discardParked(clientId: string, body: EdgeDiscardParkedRequest) {
    return this.request<undefined>('POST', `/parked/${clientId}/discard`, { body });
  }

  returnSale(number: string) {
    const query = new URLSearchParams({ number }).toString();
    return this.request<EdgeReturnSale>('GET', `/returns/sale?${query}`);
  }

  refund(body: EdgeReturnRequest) {
    return this.request<EdgePrintableReceipt>('POST', '/returns', { body });
  }

  // ADR-0065: printing, the company lookup, the store PosAPI's list.

  printReceipt(clientId: string) {
    return this.request<EdgePrintableReceipt>('GET', `/receipts/${clientId}/print`);
  }

  taxpayer(no: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ no }).toString();
    return this.request<EdgeTaxpayer>('GET', `/ebarimt/taxpayer?${query}`, { signal });
  }

  ebarimtQueue(signal?: AbortSignal) {
    return this.request<EdgeEbarimtQueue>('GET', '/ebarimt/queue', { signal });
  }

  resolveEbarimt(id: number, body: EdgeEbarimtResolveRequest) {
    return this.request<undefined>('POST', `/ebarimt/${id}/resolve`, { body });
  }

  sendData(body: EdgeEbarimtSendDataRequest) {
    return this.request<unknown>('POST', '/ebarimt/send-data', { body });
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}) {
    const { deviceToken, sessionToken } = this.credentials.getSnapshot();
    const headers = new Headers({ accept: 'application/json' });
    if (deviceToken) headers.set(EDGE_DEVICE_HEADER, deviceToken);
    if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const origin = this.baseUrl ?? window.location.origin;
    const fetchImpl: FetchLike = this.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${EDGE_API_PREFIX}${path}`, {
        method,
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new EdgeError({ status: 0, code: 'NETWORK' });
    }
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    const problem = await this.problemOf(response);
    if (problem.code === 'POS_SESSION_EXPIRED') this.credentials.signedOut('POS_SESSION_EXPIRED');
    if (problem.code === 'POS_DEVICE_UNKNOWN') this.credentials.unpaired('POS_DEVICE_UNKNOWN');
    throw new EdgeError(problem);
  }

  private async problemOf(response: Response): Promise<EdgeProblem> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!isRecord(body) || typeof body.code !== 'string') {
      return { status: response.status, code: `HTTP_${response.status}` };
    }
    return {
      status: response.status,
      code: body.code,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
      ...(isRecord(body.params) ? { params: body.params } : {}),
    };
  }
}
