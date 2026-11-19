import {
  type KeptData,
  type KeptDisk,
  type KeptPointer,
  type KeptSource,
  readKept,
  refreshKept,
  type WalkProgress,
} from './walk';

/**
 * The walk running for each server and user, across every store (a sign-out and in again as the
 * same user makes a new store while the old one's walk may still run): one at a time.
 */
const running = new Map<string, Promise<boolean>>();

/** A kept copy older than this is downloaded again at start and on return to the foreground. */
export const KEPT_STALE_MS = 6 * 3600 * 1000;

export interface KeptState {
  /** The pointer has been read (false only for the first moments after start). */
  ready: boolean;
  /** The copy in use; null when none was downloaded yet. */
  pointer: KeptPointer | null;
  /** A walk is going on: what it has. */
  progress: WalkProgress | null;
  /** The last walk failed (the copy in use is untouched). */
  failed: boolean;
}

/**
 * The kept copy of one server and user: which one is in use, its data read once on first need
 * (never at start: about 8 MiB of JSON is parsed only when a screen asks for it without the
 * server), and the refresh that replaces it whole or not at all.
 */
export class KeptStore {
  private state: KeptState = { ready: false, pointer: null, progress: null, failed: false };
  private readonly listeners = new Set<() => void>();
  private loading: { gen: string; data: Promise<KeptData | null> } | null = null;
  private refreshing: Promise<boolean> | null = null;
  private disposed = false;
  /** The copy the pointer names could not be read: download again at the next chance. */
  private unreadable = false;
  readonly ready: Promise<void>;

  private readonly disk: KeptDisk;
  private readonly source: KeptSource;
  private readonly options: { now: () => Date; newGen: () => string };

  constructor(
    disk: KeptDisk,
    source: KeptSource,
    options: { now: () => Date; newGen: () => string },
  ) {
    this.disk = disk;
    this.source = source;
    this.options = options;
    this.ready = this.disk
      .loadPointer()
      .catch(() => null)
      .then((pointer) => this.set({ ready: true, pointer }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): KeptState => this.state;

  /** Is the copy missing, unreadable or older than KEPT_STALE_MS? */
  isStale(): boolean {
    const pointer = this.state.pointer;
    if (!pointer || this.unreadable) return true;
    return this.options.now().getTime() - Date.parse(pointer.at) >= KEPT_STALE_MS;
  }

  /** The kept data, read on first need and kept in memory; null without a readable copy. */
  async data(): Promise<KeptData | null> {
    await this.ready;
    const pointer = this.state.pointer;
    if (!pointer) return null;
    if (this.loading?.gen !== pointer.gen) {
      const data = readKept(this.disk, pointer).catch(() => {
        // A copy that cannot be read is read again at the next need, and downloaded again at
        // the next moment online (`isStale`).
        this.loading = null;
        this.unreadable = true;
        return null;
      });
      this.loading = { gen: pointer.gen, data };
    }
    return this.loading.data;
  }

  /**
   * Downloads a new copy; true once it is in use, false when the walk failed or was stopped. One
   * walk at a time for this server and user, whichever store asks: a request while another
   * store's walk runs waits for it and then reads the pointer it left.
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The store is no longer the current one (signed out, another server): its walk stops. */
  dispose(): void {
    this.disposed = true;
  }

  private async doRefresh(): Promise<boolean> {
    await this.ready;
    if (this.disposed) return false;
    const other = running.get(this.disk.id);
    if (other) {
      // Another store's walk for the same user: wait, then take what it left.
      await other.catch(() => false);
      const pointer = await this.disk.loadPointer().catch(() => null);
      if (pointer && pointer.gen !== this.state.pointer?.gen) {
        this.unreadable = false;
        this.set({ pointer });
        return true;
      }
      if (this.disposed || running.has(this.disk.id)) return false;
    }
    const walk = this.walk();
    running.set(this.disk.id, walk);
    try {
      return await walk;
    } finally {
      if (running.get(this.disk.id) === walk) running.delete(this.disk.id);
    }
  }

  private async walk(): Promise<boolean> {
    this.set({ progress: { phase: 'products', rows: 0 }, failed: false });
    try {
      const pointer = await refreshKept(this.source, this.disk, {
        ...this.options,
        onProgress: (progress) => {
          if (!this.disposed) this.set({ progress });
        },
        alive: () => !this.disposed,
      });
      this.unreadable = false;
      this.set({ pointer, progress: null });
      return true;
    } catch {
      this.set({ progress: null, failed: !this.disposed });
      return false;
    }
  }

  private set(next: Partial<KeptState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}
