import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  LIVE_STOCK_PING_SECONDS,
  type LiveStockCustomerItem,
  type LiveStockEvent,
  type LiveStockStaffItem,
  type StockApp,
  stockWord,
} from '@tugeel/shared/sales';
import { Client, type Notification } from 'pg';
import { Observable, Subject, type Subscriber } from 'rxjs';
import { AppConfig } from '../../../common/config/app-config';
import { parseStockNotice, STOCK_NOTICE_CHANNEL } from '../../inventory';
import { AppSettingsService } from './app-settings.service';
import { type RepProduct, SalesRepShopService, type ShopScope } from './sales-rep-shop.service';

/** One server-sent event as Nest's `@Sse()` writes it: `type` is the event's name. */
export interface LiveStockMessage {
  type: LiveStockEvent;
  data: object;
}

/** A burst of notices becomes one message: the first id waits this long for the others. */
const FLUSH_DELAY_MS = 150;
/** More products than this in one burst (an import, a stocktake) is a `resync`, not a list. */
const MAX_LIVE_ITEMS = 500;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** A stream without a readable token expiry ends after this; the phone reconnects. */
const DEFAULT_STREAM_MS = 14 * 60_000;
/**
 * The listener is asked a `SELECT 1` this often and must answer within LIVENESS_TIMEOUT_MS: a
 * half-open connection (a NAT or firewall dropping an idle flow, a failover without a reset) raises
 * no error, and without this check the phones would stop hearing changes with nothing to tell them.
 */
const LIVENESS_EVERY_MS = 30_000;
const LIVENESS_TIMEOUT_MS = 10_000;

/** What the hub sends: to one app's streams, or to every stream (`app` null). */
interface Broadcast {
  app: StockApp | null;
  message: LiveStockMessage;
}

/**
 * The apps' live stock (ADR-0173 #4): one dedicated PostgreSQL connection LISTENs on
 * `bto_stock`, which every stock write NOTIFYs at commit (`notifyStockChanged`, from the api, the
 * worker and the CLIs alike); a burst of product ids is gathered for FLUSH_DELAY_MS, then each app
 * with an open stream gets one `stock` message computed once through the shop's own read model —
 * the same numbers and words its lists show. The values are product facts, the same for every
 * stream of an app (a staff member's segments only hide products; the phone ignores ids it does
 * not hold). Provided only in the api's HTTP app; the listener connects with the first stream, so
 * a process nobody watches holds no extra connection, and reconnects with backoff, sending every
 * stream a `resync` once it is back (notices sent meanwhile are lost).
 */
@Injectable()
export class LiveStockHub implements OnModuleDestroy {
  private readonly logger = new Logger('LiveStockHub');
  private readonly broadcasts = new Subject<Broadcast>();
  private readonly streams: Record<StockApp, number> = { CUSTOMER: 0, STAFF: 0 };
  /** Every open stream, completed at shutdown so the HTTP server can close. */
  private readonly open = new Set<Subscriber<LiveStockMessage>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private liveness: NodeJS.Timeout | null = null;
  /** Counts the resync notices heard: a flush that saw one during its work drops its numbers. */
  private resyncs = 0;
  private pending = new Set<number>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** Flushes run one after another, so an older burst never overwrites a newer one. */
  private flushing: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly shop: SalesRepShopService,
    private readonly settings: AppSettingsService,
  ) {}

  /**
   * One app's stream until `durationMs` passes (the access token's expiry): `ready` once the
   * listener is up (the phone refetches, so nothing between its last read and now is lost), then
   * `stock` and `resync` as they come, a `ping` every LIVE_STOCK_PING_SECONDS.
   */
  stream(app: StockApp, durationMs: number): Observable<LiveStockMessage> {
    return new Observable<LiveStockMessage>((subscriber) => {
      if (this.stopped) {
        subscriber.complete();
        return undefined;
      }
      let open = true;
      this.streams[app] += 1;
      this.open.add(subscriber);
      const subscription = this.broadcasts.subscribe((broadcast) => {
        if (broadcast.app === null || broadcast.app === app) subscriber.next(broadcast.message);
      });
      const ping = setInterval(
        () => subscriber.next({ type: 'ping', data: {} }),
        LIVE_STOCK_PING_SECONDS * 1_000,
      );
      const end = setTimeout(() => subscriber.complete(), Math.max(1_000, durationMs));
      void this.listen().then(() => {
        if (open) subscriber.next({ type: 'ready', data: {} });
      });
      return () => {
        open = false;
        this.streams[app] -= 1;
        this.open.delete(subscriber);
        subscription.unsubscribe();
        clearInterval(ping);
        clearTimeout(end);
      };
    });
  }

  /** How many streams each app has open (the tests and the status page). */
  openStreams(): Record<StockApp, number> {
    return { ...this.streams };
  }

  /**
   * Resolves once the listener is connected, or once a first attempt failed (the reconnect loop
   * keeps trying and announces a `resync` when it succeeds). Never rejects.
   */
  listen(): Promise<void> {
    if (this.stopped || this.client) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /**
   * Before the HTTP server closes (Nest calls this first): every stream ends, so the phones
   * reconnect to the next process and the server is not held open by them; the listener goes.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.liveness) clearInterval(this.liveness);
    for (const subscriber of [...this.open]) subscriber.complete();
    this.broadcasts.complete();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL'),
      application_name: 'tugeel-api-live',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    // An 'error' event without a listener would crash the process; both end in a reconnect.
    client.on('error', (err) => this.lost(client, err));
    client.on('end', () => this.lost(client));
    client.on('notification', (notice) => this.heard(notice));
    try {
      await client.connect();
      await client.query(`LISTEN ${STOCK_NOTICE_CHANNEL}`);
    } catch (err) {
      this.logger.warn({ err }, 'live stock listener could not connect');
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    const recovered = this.reconnectDelay > RECONNECT_MIN_MS;
    this.client = client;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.watch(client);
    // Notices sent while nobody listened are gone: every phone refetches.
    if (recovered) this.broadcast(null, { type: 'resync', data: {} });
  }

  /** The liveness check of one connection; a missed answer is a lost connection. */
  private watch(client: Client): void {
    if (this.liveness) clearInterval(this.liveness);
    this.liveness = setInterval(() => {
      if (this.client !== client) return;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('live stock listener did not answer')),
          LIVENESS_TIMEOUT_MS,
        );
      });
      Promise.race([client.query('SELECT 1'), timeout])
        .catch((err: unknown) => this.lost(client, err instanceof Error ? err : undefined))
        .finally(() => clearTimeout(timer));
    }, LIVENESS_EVERY_MS);
    this.liveness.unref();
  }

  private lost(client: Client, err?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.liveness) clearInterval(this.liveness);
    this.liveness = null;
    if (this.stopped) return;
    this.logger.warn({ err }, 'live stock listener lost its connection');
    client.removeAllListeners('end');
    void client.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.listen();
    }, delay);
    // Only open streams care; a reconnect never keeps the process alive on its own.
    this.reconnectTimer.unref();
  }

  private heard(notice: Notification): void {
    if (notice.channel !== STOCK_NOTICE_CHANNEL) return;
    const parsed = parseStockNotice(notice.payload);
    if (parsed === 'RESYNC') {
      this.resyncs += 1;
      this.broadcast(null, { type: 'resync', data: {} });
      return;
    }
    for (const id of parsed) this.pending.add(id);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const ids = [...this.pending].sort((a, b) => a - b);
      this.pending = new Set();
      this.flushing = this.flushing.then(() => this.flush(ids));
    }, FLUSH_DELAY_MS);
  }

  /** One burst: each app with an open stream gets its products' values, computed once. */
  private async flush(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    if (ids.length > MAX_LIVE_ITEMS) {
      this.broadcast(null, { type: 'resync', data: {} });
      return;
    }
    try {
      if (this.streams.STAFF > 0) {
        this.broadcast('STAFF', { type: 'stock', data: { items: await this.staffItems(ids) } });
      }
      if (this.streams.CUSTOMER > 0) {
        this.broadcast('CUSTOMER', {
          type: 'stock',
          data: { items: await this.customerItems(ids) },
        });
      }
    } catch (err) {
      this.logger.error({ err }, 'live stock values failed; streams told to refetch');
      this.broadcast(null, { type: 'resync', data: {} });
    }
  }

  /**
   * The staff app's values: every product's, as `GET /sales-rep/products` shows them (no staff
   * member's segments: the phone ignores products it does not hold). A product the shop no longer
   * lists reads 0.
   */
  async staffItems(ids: readonly number[]): Promise<LiveStockStaffItem[]> {
    const counted = (await this.settings.stockWarehouses()).STAFF;
    const scope: ShopScope = {
      segmentIds: null,
      countedWarehouseIds: counted.length === 0 ? null : counted,
    };
    const rows = await this.byId(scope, ids);
    return ids.map((productId) => {
      const row = rows.get(productId);
      return row
        ? { productId, available: row.available.toString(), stockBlocked: row.stockBlocked }
        : { productId, available: '0', stockBlocked: false };
    });
  }

  /**
   * «Bto300»'s values: the word always, the number only with NUMBER (ADR-0173 #2). A product the
   * shop no longer lists (outside the segment, no home) reads OUT.
   */
  async customerItems(ids: readonly number[]): Promise<LiveStockCustomerItem[]> {
    // The display is read after the values, and a resync heard meanwhile (the office switched
    // NUMBER → WORDS, say) drops the numbers: a message built under NUMBER never reaches the phones
    // after WORDS is in force and its resync went out.
    const resyncsBefore = this.resyncs;
    const rows = await this.byId(await this.shop.customerScope(), ids);
    const number =
      (await this.settings.customerStockDisplay()) === 'NUMBER' && this.resyncs === resyncsBefore;
    return ids.map((productId) => {
      const row = rows.get(productId);
      const listed = row !== undefined && row.homeWarehouseId !== null;
      return {
        productId,
        stock: listed ? stockWord(row.available, row.minLevel, row.packBase) : 'OUT',
        ...(number ? { available: listed ? row.available.toString() : '0' } : {}),
      };
    });
  }

  private async byId(scope: ShopScope, ids: readonly number[]): Promise<Map<number, RepProduct>> {
    return new Map((await this.shop.productsOf(scope, ids)).map((row) => [row.id, row]));
  }

  private broadcast(app: StockApp | null, message: LiveStockMessage): void {
    if (!this.stopped) this.broadcasts.next({ app, message });
  }
}

/**
 * How long a stream may stay open: until the bearer token's `exp` (the guard has verified it),
 * else DEFAULT_STREAM_MS; at least one second.
 */
export function streamDuration(authorization: string | undefined, now = Date.now()): number {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const payload = token.split('.')[1];
  if (payload) {
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        exp?: unknown;
      };
      if (typeof exp === 'number' && Number.isFinite(exp)) {
        return Math.max(1_000, Math.min(exp * 1_000 - now, 24 * 60 * 60_000));
      }
    } catch {
      // Not a JWT we can read: the default below.
    }
  }
  return DEFAULT_STREAM_MS;
}
