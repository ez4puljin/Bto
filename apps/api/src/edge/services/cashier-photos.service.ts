import { Injectable, Logger } from '@nestjs/common';
import { CentralClient } from './central.client';
import { SnapshotStore } from './snapshot.store';

/** A photo larger than this is not kept (the card photos are small). */
const MAX_BYTES = 2 * 1024 * 1024;
/** After a miss (the centre away, no file), the photo is asked again only after this long. */
const RETRY_MS = 5 * 60_000;

interface Photo {
  contentType: string;
  bytes: Buffer;
}

/**
 * The cashiers' card photos for the till's sign-in screen (owner 2026-11-17): fetched from the
 * centre the first time a till asks and kept in memory by their public path, so the screen still
 * shows them while the centre is away. A cashier without one shows the initial.
 */
@Injectable()
export class CashierPhotosService {
  private readonly logger = new Logger(CashierPhotosService.name);
  private readonly kept = new Map<string, Photo>();
  private readonly missedAt = new Map<string, number>();

  constructor(
    private readonly store: SnapshotStore,
    private readonly central: CentralClient,
  ) {}

  async photoOf(userId: number): Promise<Photo | null> {
    const path = this.store.get().cashiers.get(userId)?.photoUrl ?? null;
    if (!path) return null;
    const kept = this.kept.get(path);
    if (kept) return kept;
    const missed = this.missedAt.get(path);
    if (missed !== undefined && Date.now() - missed < RETRY_MS) return null;
    try {
      const photo = await this.central.publicFile(path, MAX_BYTES);
      if (!photo) {
        this.missedAt.set(path, Date.now());
        return null;
      }
      this.forgetOld();
      this.kept.set(path, photo);
      this.missedAt.delete(path);
      return photo;
    } catch (error: unknown) {
      this.missedAt.set(path, Date.now());
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'cashier photo not fetched; the initial is shown',
      );
      return null;
    }
  }

  /** Drops the photos no cashier of the snapshot has any more (a replaced photo). */
  private forgetOld(): void {
    const current = new Set(
      [...this.store.get().cashiers.values()].flatMap((cashier) =>
        cashier.photoUrl ? [cashier.photoUrl] : [],
      ),
    );
    for (const path of this.kept.keys()) if (!current.has(path)) this.kept.delete(path);
  }
}
