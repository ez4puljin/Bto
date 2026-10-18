import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeState } from '../db/schema';
import { CentralClient, CentralError } from './central.client';
import { OutboxService } from './outbox.service';
import { SnapshotStore } from './snapshot.store';

const BATCH = 50;
const HEARTBEAT_MS = 30_000;
const DEFAULT_PULL_MS = 60_000;
/** After a failed call: wait longer each time, up to a minute. */
const MAX_BACKOFF_MS = 60_000;

/** What one push did: nothing to send, sent (with how many applied or rejected), or failed. */
export type PushResult =
  | { state: 'idle' }
  | { state: 'sent'; applied: number; rejected: number }
  | { state: 'failed'; error: string };

/**
 * The edge's three loops (ADR-0063 #4, ADR-0067): pull the snapshot, push the outbox in order,
 * beat the heart. In-process timers (no pg-boss on the edge); each loop waits for its own last
 * run, and a failure only slows it down. Tests turn the timers off and call the steps.
 */
@Injectable()
export class SyncRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncRunner.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private stopped = false;
  private pushBackoff = 0;
  private pushing: Promise<PushResult> | null = null;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly config: EdgeConfig,
    private readonly central: CentralClient,
    private readonly outbox: OutboxService,
    private readonly store: SnapshotStore,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('EDGE_TIMERS')) return;
    this.loop('pull', 0, async () => {
      await this.pullOnce();
      const seconds = this.store.peek()?.snapshot.settings.snapshotIntervalSec;
      return seconds ? seconds * 1_000 : DEFAULT_PULL_MS;
    });
    this.loop('push', 1_000, async () => {
      const result = await this.pushOnce();
      if (result.state === 'failed') {
        this.pushBackoff = Math.min(MAX_BACKOFF_MS, Math.max(2_000, this.pushBackoff * 2));
        return this.pushBackoff;
      }
      this.pushBackoff = 0;
      return result.state === 'sent' ? 0 : this.config.get('EDGE_PUSH_INTERVAL_MS');
    });
    this.loop('heartbeat', 5_000, async () => {
      await this.heartbeatOnce();
      return HEARTBEAT_MS;
    });
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Fetches the snapshot unless the centre says the edge already holds it. */
  async pullOnce(): Promise<'changed' | 'unchanged' | 'failed'> {
    try {
      const answer = await this.central.snapshot(this.store.version());
      await this.store.apply(answer.changed ? answer.snapshot : null);
      await this.noteContact(null);
      return answer.changed ? 'changed' : 'unchanged';
    } catch (error: unknown) {
      await this.noteContact(describe(error));
      return 'failed';
    }
  }

  /** Sends the oldest pending documents, at most one push at a time. */
  pushOnce(): Promise<PushResult> {
    if (!this.pushing) {
      this.pushing = this.push().finally(() => {
        this.pushing = null;
      });
    }
    return this.pushing;
  }

  async heartbeatOnce(): Promise<boolean> {
    try {
      const counts = await this.outbox.counts();
      await this.central.heartbeat({
        appVersion: this.config.get('APP_VERSION'),
        backlog: counts.pending,
        clockSkewMs: null,
        snapshotVersion: this.store.version(),
      });
      await this.noteContact(null);
      return true;
    } catch (error: unknown) {
      await this.noteContact(describe(error));
      return false;
    }
  }

  private async push(): Promise<PushResult> {
    const batch = await this.outbox.pending(BATCH);
    if (batch.length === 0) return { state: 'idle' };
    try {
      const answer = await this.central.push(batch.map((event) => event.payload));
      await this.outbox.settle(batch, answer.results);
      const now = new Date();
      await this.db
        .update(edgeState)
        .set({ lastPushAt: now, lastContactAt: now, lastError: null, updatedAt: now })
        .where(eq(edgeState.id, 1));
      const rejected = answer.results.filter((result) => result.status === 'REJECTED').length;
      if (rejected) this.logger.warn({ rejected }, 'the centre refused documents; they are parked');
      return { state: 'sent', applied: answer.results.length - rejected, rejected };
    } catch (error: unknown) {
      const message = describe(error);
      await this.outbox.failed(batch, message);
      await this.noteContact(message);
      return { state: 'failed', error: message };
    }
  }

  private async noteContact(error: string | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(edgeState)
      .values({
        id: 1,
        ...(error ? { lastError: error } : { lastContactAt: now, lastError: null }),
      })
      .onConflictDoUpdate({
        target: edgeState.id,
        set: error
          ? { lastError: error, updatedAt: now }
          : { lastContactAt: now, lastError: null, updatedAt: now },
      });
  }

  private loop(name: string, firstDelayMs: number, step: () => Promise<number>): void {
    const run = async () => {
      if (this.stopped) return;
      let next = DEFAULT_PULL_MS;
      try {
        next = await step();
      } catch (error: unknown) {
        this.logger.error({ loop: name, error: describe(error) }, 'sync loop failed');
      }
      if (this.stopped) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void run();
      }, next);
      this.timers.add(timer);
    };
    const first = setTimeout(() => {
      this.timers.delete(first);
      void run();
    }, firstDelayMs);
    this.timers.add(first);
  }
}

function describe(error: unknown): string {
  if (error instanceof CentralError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
