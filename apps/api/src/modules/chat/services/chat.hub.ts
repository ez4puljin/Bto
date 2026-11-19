import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Client, type Notification } from 'pg';
import { Observable, type Subscriber } from 'rxjs';
import { AppConfig } from '../../../common/config/app-config';
import type { AuthContext } from '../../identity';
import { CHAT_PING_SECONDS, type ChatLiveEvent } from '@tugeel/shared/chat';
import { customerLiveDto, staffLiveDto } from '../dto/chat.mappers';
import { CHAT_NOTICE_CHANNEL, type ChatNotice, parseChatNotice } from './chat-notify';
import { ChatRepsService, type ChatScope } from './chat-reps.service';
import { ChatService } from './chat.service';

/** One server-sent event as Nest's `@Sse()` writes it: `type` is the event's name. */
export interface ChatLiveMessage {
  type: ChatLiveEvent;
  data: object;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** As the live stock listener (ADR-0173 #4): a half-open connection raises no error by itself. */
const LIVENESS_EVERY_MS = 30_000;
const LIVENESS_TIMEOUT_MS = 10_000;
/** A rep's round is read again for an open stream when it is older than this. */
const SCOPE_MAX_AGE_MS = 60_000;

/** An open stream: a store's, or a staff member's with the stores they may answer. */
type Stream =
  | { kind: 'CUSTOMER'; customerId: number; out: Subscriber<ChatLiveMessage> }
  | {
      kind: 'STAFF';
      ctx: AuthContext;
      scope: ChatScope;
      scopeAt: number;
      out: Subscriber<ChatLiveMessage>;
    };

/**
 * The chat's live streams (ADR-0224 #7): one dedicated PostgreSQL connection per api process
 * LISTENs on `bto_chat`, which every chat write NOTIFYs at commit. A notice names a conversation
 * and its new message; the hub reads them once (only when a stream of this process cares) and
 * sends the store's streams and the staff streams whose scope holds the store the same wire
 * shapes the routes answer with. Nothing is kept in memory between processes: the customer and
 * the staff member may be on different replicas (ADR-0192). The listener connects with the first
 * stream and reconnects with backoff, telling every stream to `resync` once it is back.
 */
@Injectable()
export class ChatHub implements OnModuleDestroy {
  private readonly logger = new Logger('ChatHub');
  private readonly streams = new Set<Stream>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private liveness: NodeJS.Timeout | null = null;
  /** Notices are handled one after another, so a stream gets the messages in their order. */
  private working: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly chat: ChatService,
    private readonly reps: ChatRepsService,
  ) {}

  /** A store's stream until `durationMs` passes (the access token's expiry). */
  customerStream(customerId: number, durationMs: number): Observable<ChatLiveMessage> {
    return this.open((out) => ({ kind: 'CUSTOMER', customerId, out }), durationMs);
  }

  /** A staff member's stream: the conversations of `scope`, the caller's own at the opening. */
  staffStream(ctx: AuthContext, scope: ChatScope, durationMs: number): Observable<ChatLiveMessage> {
    return this.open(
      (out) => ({ kind: 'STAFF', ctx, scope, scopeAt: Date.now(), out }),
      durationMs,
    );
  }

  /** How many streams are open (the tests). */
  openStreams(): number {
    return this.streams.size;
  }

  /** Resolves once the listener is connected, or once a first attempt failed. Never rejects. */
  listen(): Promise<void> {
    if (this.stopped || this.client) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /** Before the HTTP server closes: every stream ends and the listener goes. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.liveness) clearInterval(this.liveness);
    for (const stream of [...this.streams]) stream.out.complete();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }

  private open(
    make: (out: Subscriber<ChatLiveMessage>) => Stream,
    durationMs: number,
  ): Observable<ChatLiveMessage> {
    return new Observable<ChatLiveMessage>((out) => {
      if (this.stopped) {
        out.complete();
        return undefined;
      }
      let open = true;
      const stream = make(out);
      this.streams.add(stream);
      const ping = setInterval(
        () => out.next({ type: 'ping', data: {} }),
        CHAT_PING_SECONDS * 1_000,
      );
      const end = setTimeout(() => out.complete(), Math.max(1_000, durationMs));
      void this.listen().then(() => {
        if (open) out.next({ type: 'ready', data: {} });
      });
      return () => {
        open = false;
        this.streams.delete(stream);
        clearInterval(ping);
        clearTimeout(end);
      };
    });
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL'),
      application_name: 'tugeel-api-chat',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    // An 'error' event without a listener would crash the process; both end in a reconnect.
    client.on('error', (err) => this.lost(client, err));
    client.on('end', () => this.lost(client));
    client.on('notification', (notice) => this.heard(notice));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHAT_NOTICE_CHANNEL}`);
    } catch (err) {
      this.logger.warn({ err }, 'chat listener could not connect');
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
    // Notices sent while nobody listened are gone: every screen refetches.
    if (recovered) this.resync();
  }

  private watch(client: Client): void {
    if (this.liveness) clearInterval(this.liveness);
    this.liveness = setInterval(() => {
      if (this.client !== client) return;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('chat listener did not answer')),
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
    this.logger.warn({ err }, 'chat listener lost its connection');
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

  private resync(): void {
    for (const stream of this.streams) stream.out.next({ type: 'resync', data: {} });
  }

  private heard(notification: Notification): void {
    if (notification.channel !== CHAT_NOTICE_CHANNEL) return;
    const notice = parseChatNotice(notification.payload);
    if (!notice) {
      this.resync();
      return;
    }
    this.working = this.working.then(() =>
      this.deliver(notice).catch((err: unknown) => {
        this.logger.error({ err }, 'a chat notice failed; streams told to refetch');
        this.resync();
      }),
    );
  }

  /** One notice: read once when a stream of this process cares, then sent to each of them. */
  private async deliver(notice: ChatNotice): Promise<void> {
    const cares = [...this.streams].some(
      (stream) => stream.kind === 'STAFF' || stream.customerId === notice.customerId,
    );
    if (!cares) return;
    const snapshot = await this.chat.snapshot(notice.conversationId, notice.messageId);
    if (!snapshot) return;
    const type: ChatLiveEvent = snapshot.message ? 'message' : 'conversation';
    const customer = customerLiveDto(snapshot.customer, snapshot.message);
    const staff = staffLiveDto(snapshot.staff, snapshot.message);
    for (const stream of [...this.streams]) {
      if (stream.kind === 'CUSTOMER') {
        if (stream.customerId === notice.customerId) stream.out.next({ type, data: customer });
      } else if (await this.inScope(stream, notice.customerId)) {
        stream.out.next({ type, data: staff });
      }
    }
  }

  /** Whether a staff stream may hear of a store; a rep's round is read again when it is old. */
  private async inScope(
    stream: Extract<Stream, { kind: 'STAFF' }>,
    customerId: number,
  ): Promise<boolean> {
    if (stream.scope.all) return true;
    if (Date.now() - stream.scopeAt > SCOPE_MAX_AGE_MS) {
      stream.scope = await this.reps.scopeOf(stream.ctx);
      stream.scopeAt = Date.now();
    }
    return stream.scope.all || stream.scope.customerIds.has(customerId);
  }
}
