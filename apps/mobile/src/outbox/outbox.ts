import {
  afterAttempt,
  type Attempt,
  entryFromRaw,
  mayDelete,
  nextWaiting,
  type OutboxEntry,
  prepare,
  prune,
} from './entry';
import type { OutboxStore } from './storage';

/** The stored canonical body as the request sends it (an unreadable one goes as null). */
function bodyOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** What the outbox needs from the phone and the server; tests pass their own. */
export interface OutboxIO<O> {
  /** The entries on the phone (`src/outbox/storage.ts`); every call rejects when storage fails. */
  store: OutboxStore;
  /** One request with its key; never throws (`attemptOf`). */
  post: (body: unknown, key: string) => Promise<Attempt<O>>;
  now: () => Date;
  newKey: () => string;
  orderRef: (order: O) => { id: number; number: string | null };
}

/** What a run did: whether it stopped for want of an answer, and how many arrived. */
export interface RunReport {
  sent: number;
  noAnswer: boolean;
}

/** What the screens read. */
export interface OutboxState {
  entries: readonly OutboxEntry[];
  /** The stored entries could not be read: nothing is written, run or added until they are. */
  readFailed: boolean;
  /** An entry's latest state could not be written (it is written again at the next chance). */
  writeFailed: boolean;
}

/** Thrown by `add` while the stored entries have not been read. */
export class OutboxNotRead extends Error {
  constructor() {
    super('the outbox has not been read');
    this.name = 'OutboxNotRead';
  }
}

const NO_RUN: RunReport = { sent: 0, noAnswer: false };

/**
 * The rep's outbox on one server for one user: entries on the phone, each written before its
 * request leaves, and the runner that sends them one at a time, oldest first. No answer (or a
 * 5xx) stops the run; a refusal marks its entry and the run goes on, so one bad order never holds
 * the others back. A failed read never empties anything; a failed write is never hidden.
 */
export class Outbox<O> {
  private state: OutboxState = { entries: [], readFailed: false, writeFailed: false };
  private loaded = false;
  private disposed = false;
  private readonly io: OutboxIO<O>;
  private readonly listeners = new Set<() => void>();
  /** The full answers of the orders sent in this app's life (the «sent» card shows them). */
  private readonly orders = new Map<string, O>();
  /** Entries whose latest state is not on the phone yet, and a failed write before a request. */
  private readonly dirty = new Map<string, OutboxEntry>();
  private blocked = false;
  private running: Promise<RunReport> | null = null;
  private queued: Promise<RunReport> | null = null;
  private reading: Promise<void> | null = null;
  ready: Promise<void>;

  constructor(io: OutboxIO<O>) {
    this.io = io;
    this.ready = this.read();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OutboxState => this.state;

  get(id: string): OutboxEntry | undefined {
    return this.state.entries.find((entry) => entry.id === id);
  }

  /** The 201's order of an entry sent while the app ran. */
  orderOf(id: string): O | undefined {
    return this.orders.get(id);
  }

  hasWaiting(): boolean {
    return this.state.entries.some((entry) => entry.status === 'waiting');
  }

  /** Reads the stored entries again after a failed read (the next foreground); no-op otherwise. */
  retryRead(): Promise<void> {
    if (this.loaded || this.disposed) return this.ready;
    this.ready = this.read();
    return this.ready;
  }

  /**
   * The provider is gone (signed out, another server): no new request from here on (an answer
   * already on its way is still written down).
   */
  dispose(): void {
    this.disposed = true;
  }

  /**
   * Stores an entry, and `also` with it in the same write (the emptied cart); resolves once both
   * are on the phone, rejects (nothing added) when they are not or the stored entries are unread.
   */
  async add(entry: OutboxEntry, also?: [string, string][]): Promise<void> {
    await this.ready;
    if (!this.loaded) throw new OutboxNotRead();
    if (this.get(entry.id)) return;
    await this.io.store.put([entry], also);
    this.blocked = false;
    this.set({ entries: [...this.state.entries, entry] });
  }

  /**
   * Removes an entry the rep deleted or took back into the cart (never one whose request is out,
   * nor an unreadable one). Rejects when the storage fails: the entry then stays.
   */
  async remove(id: string): Promise<boolean> {
    await this.ready;
    const entry = this.get(id);
    if (!this.loaded || !entry || !mayDelete(entry)) return false;
    await this.io.store.drop([id]);
    this.dirty.delete(id);
    this.set({ entries: this.state.entries.filter((one) => one.id !== id) });
    return true;
  }

  /**
   * Sends the waiting entries, oldest first. One run at a time: a call during a run gets a run
   * that starts after it (an entry added meanwhile is never left out).
   */
  run(): Promise<RunReport> {
    if (!this.running) {
      this.running = this.runOnce().finally(() => {
        this.running = null;
      });
      return this.running;
    }
    this.queued ??= this.running
      .catch(() => undefined)
      .then(() => {
        this.queued = null;
        return this.run();
      });
    return this.queued;
  }

  private async runOnce(): Promise<RunReport> {
    await this.ready;
    if (!this.loaded || this.disposed) return NO_RUN;
    await this.flush();
    const report: RunReport = { sent: 0, noAnswer: false };
    const tried = new Set<string>();
    for (;;) {
      if (this.disposed) break;
      const next = nextWaiting(this.state.entries, tried);
      if (!next) break;
      tried.add(next.id);
      const prepared = prepare(next, this.io.now(), this.io.newKey);
      if (prepared.status === 'check') {
        await this.save(prepared);
        continue;
      }
      // The entry, with its key (a new one after six days included), is on the phone as
      // `sending` before the request leaves; if it cannot be written, nothing is sent.
      const sending: OutboxEntry = { ...prepared, status: 'sending' };
      try {
        await this.io.store.put([sending]);
      } catch {
        this.blocked = true;
        this.set({});
        break;
      }
      this.blocked = false;
      this.dirty.delete(sending.id);
      this.set({ entries: this.swap(sending) });
      const attempt = await this.io.post(bodyOf(prepared.body), prepared.key);
      const { entry, go } = afterAttempt(prepared, attempt, this.io.now(), this.io.orderRef);
      if (attempt.order !== null && entry.status === 'sent') {
        this.orders.set(entry.id, attempt.order);
        report.sent += 1;
      }
      await this.save(entry);
      if (go === 'stop') {
        report.noAnswer = true;
        break;
      }
    }
    return report;
  }

  private async read(): Promise<void> {
    this.reading ??= this.doRead().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async doRead(): Promise<void> {
    let raw;
    try {
      raw = await this.io.store.readAll();
    } catch {
      // Could not read: nothing is written, run or added; the next foreground reads again.
      this.set({ readFailed: true });
      return;
    }
    const read = raw.map((item) => entryFromRaw(item.id, item.raw));
    const entries = read.map((item) => item.entry);
    const kept = prune(entries, this.io.now());
    const pruned = entries.filter((entry) => !kept.includes(entry)).map((entry) => entry.id);
    const changed = read.filter((item) => item.changed).map((item) => item.entry);
    this.loaded = true;
    for (const entry of changed) this.dirty.set(entry.id, entry);
    this.set({ entries: kept, readFailed: false });
    // Written back only what really changed: a `sending` found now waits; old sent ones go.
    await this.flush();
    if (pruned.length > 0) await this.io.store.drop(pruned).catch(() => undefined);
  }

  /** An entry's new state: in memory at once, then on the phone; a failed write stays dirty. */
  private async save(entry: OutboxEntry): Promise<void> {
    this.dirty.set(entry.id, entry);
    this.set({ entries: this.swap(entry) });
    await this.flush();
  }

  /** Writes every dirty entry; any that fail stay dirty and keep `writeFailed` on. */
  private async flush(): Promise<void> {
    for (const [id, entry] of [...this.dirty]) {
      if (entry.damaged) {
        this.dirty.delete(id);
        continue;
      }
      try {
        await this.io.store.put([entry]);
        if (this.dirty.get(id) === entry) this.dirty.delete(id);
      } catch {
        // Kept dirty: written again at the next save or run.
      }
    }
    this.set({});
  }

  private swap(entry: OutboxEntry): OutboxEntry[] {
    return this.state.entries.map((one) => (one.id === entry.id ? entry : one));
  }

  private set(next: Partial<OutboxState>): void {
    const writeFailed = this.dirty.size > 0 || this.blocked;
    const entries = next.entries ?? this.state.entries;
    const readFailed = next.readFailed ?? this.state.readFailed;
    if (
      entries === this.state.entries &&
      readFailed === this.state.readFailed &&
      writeFailed === this.state.writeFailed
    ) {
      return;
    }
    this.state = { entries, readFailed, writeFailed };
    for (const listener of this.listeners) listener();
  }
}
