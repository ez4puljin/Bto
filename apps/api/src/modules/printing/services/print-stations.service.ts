import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { PrintError } from '../printing.errors';
import {
  PRINT_LIMITS,
  type PrintStationKind,
  type PrintStationStatus,
  type PrintWidth,
} from '../printing.rules';
import { printStations } from '../schema';

export interface PrintStation {
  id: number;
  name: string;
  kind: PrintStationKind;
  host: string | null;
  port: number | null;
  printerName: string | null;
  widthDots: PrintWidth;
  status: PrintStationStatus;
  lastSeenAt: Date | null;
  online: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrintStationInput {
  name: string;
  kind: PrintStationKind;
  host?: string | null;
  port?: number | null;
  widthDots?: PrintWidth;
}

export interface PrintStationPatch {
  name?: string;
  host?: string | null;
  port?: number | null;
  widthDots?: PrintWidth;
  status?: PrintStationStatus;
}

type StationRow = typeof printStations.$inferSelect;

/** `bps_<station>_<secret>`: the bridge's key, shown once (ADR-0226 #4). */
const KEY_PATTERN = /^bps_(\d{1,12})_([A-Za-z0-9_-]{20,100})$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** A host name or an IPv4 address, nothing that could carry a path or a port. */
const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/**
 * The printers price labels go to (ADR-0226 #4). The office (`pos.manage`) adds, edits and
 * disables them; a BRIDGE station gets a key, kept as a sha-256 and shown only when it is made or
 * made again. A station is online when its bridge called (or the api last reached it) within a
 * minute.
 */
@Injectable()
export class PrintStationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(options: { activeOnly?: boolean } = {}): Promise<PrintStation[]> {
    const rows = await this.db
      .select()
      .from(printStations)
      .where(options.activeOnly ? eq(printStations.status, 'ACTIVE') : undefined)
      .orderBy(asc(printStations.name), asc(printStations.id));
    return rows.map(view);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<PrintStation> {
    const [row] = await executor.select().from(printStations).where(eq(printStations.id, id));
    if (!row) throw new PrintError('PRINT_STATION_NOT_FOUND', `print station ${id}`, { id });
    return view(row);
  }

  /** An active station, or PRINT_STATION_NOT_FOUND. */
  async active(id: number, executor: Db | Tx = this.db): Promise<PrintStation> {
    const station = await this.get(id, executor);
    if (station.status !== 'ACTIVE') {
      throw new PrintError('PRINT_STATION_NOT_FOUND', `print station ${id} is disabled`, { id });
    }
    return station;
  }

  async create(
    ctx: AuthContext,
    input: PrintStationInput,
  ): Promise<{ station: PrintStation; key: string | null }> {
    const name = checkedName(input.name);
    const network = input.kind === 'NETWORK' ? checkedAddress(input.host, input.port) : null;
    const secret = input.kind === 'BRIDGE' ? randomBytes(24).toString('base64url') : null;
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(printStations)
        .values({
          name,
          kind: input.kind,
          host: network?.host ?? null,
          port: network?.port ?? null,
          // Replaced below, once the id is known: the hash covers the whole key.
          keyHash: secret ? 'pending' : null,
          widthDots: input.widthDots ?? 576,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('print station not inserted');
      let key: string | null = null;
      let saved = row;
      if (secret) {
        key = `bps_${row.id}_${secret}`;
        const [updated] = await tx
          .update(printStations)
          .set({ keyHash: sha256(key) })
          .where(eq(printStations.id, row.id))
          .returning();
        if (updated) saved = updated;
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'print_stations',
        entityId: row.id,
        after: auditable(saved),
      });
      return { station: view(saved), key };
    });
  }

  async update(ctx: AuthContext, id: number, patch: PrintStationPatch): Promise<PrintStation> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(printStations)
        .where(eq(printStations.id, id))
        .for('update');
      if (!before) throw new PrintError('PRINT_STATION_NOT_FOUND', `print station ${id}`, { id });
      const changes: Partial<typeof printStations.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) changes.name = checkedName(patch.name);
      if (before.kind === 'NETWORK' && (patch.host !== undefined || patch.port !== undefined)) {
        const address = checkedAddress(
          patch.host === undefined ? before.host : patch.host,
          patch.port === undefined ? before.port : patch.port,
        );
        changes.host = address.host;
        changes.port = address.port;
      }
      if (patch.widthDots !== undefined) changes.widthDots = patch.widthDots;
      if (patch.status !== undefined) changes.status = patch.status;
      const [after] = await tx
        .update(printStations)
        .set(changes)
        .where(eq(printStations.id, id))
        .returning();
      if (!after) throw new Error('print station not updated');
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'print_stations',
        entityId: id,
        before: auditable(before),
        after: auditable(after),
      });
      return view(after);
    });
  }

  /** A BRIDGE station's new key; the old one stops working at once. */
  async newKey(ctx: AuthContext, id: number): Promise<{ station: PrintStation; key: string }> {
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(printStations)
        .where(eq(printStations.id, id))
        .for('update');
      if (!row) throw new PrintError('PRINT_STATION_NOT_FOUND', `print station ${id}`, { id });
      if (row.kind !== 'BRIDGE') throw invalid('kind', 'bridge', 'only a bridge has a key');
      const key = `bps_${id}_${randomBytes(24).toString('base64url')}`;
      const [after] = await tx
        .update(printStations)
        .set({ keyHash: sha256(key), updatedAt: new Date() })
        .where(eq(printStations.id, id))
        .returning();
      if (!after) throw new Error('print station not updated');
      await this.audit.record(tx, ctx, {
        action: 'TOKEN_ISSUED',
        entity: 'print_stations',
        entityId: id,
      });
      return { station: view(after), key };
    });
  }

  /**
   * The ACTIVE BRIDGE station whose key this is, marked seen now (with the Windows printer the
   * bridge names, when it names one); PRINT_KEY_INVALID otherwise.
   */
  async authenticate(key: string, printerName?: string | null): Promise<PrintStation> {
    const match = KEY_PATTERN.exec(key.trim());
    const refuse = () => new PrintError('PRINT_KEY_INVALID', 'print bridge key refused');
    if (!match?.[1]) throw refuse();
    const id = Number.parseInt(match[1], 10);
    const [row] = await this.db.select().from(printStations).where(eq(printStations.id, id));
    if (!row?.keyHash || row.kind !== 'BRIDGE' || row.status !== 'ACTIVE') throw refuse();
    const presented = Buffer.from(sha256(key.trim()), 'hex');
    const stored = Buffer.from(row.keyHash, 'hex');
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) throw refuse();
    const name = printerName?.trim().slice(0, 200) || null;
    const [seen] = await this.db
      .update(printStations)
      .set({ lastSeenAt: new Date(), ...(name ? { printerName: name } : {}) })
      .where(eq(printStations.id, id))
      .returning();
    return view(seen ?? row);
  }

  /** The api reached a NETWORK printer. */
  async touch(id: number): Promise<void> {
    await this.db
      .update(printStations)
      .set({ lastSeenAt: new Date() })
      .where(eq(printStations.id, id));
  }
}

function checkedName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > PRINT_LIMITS.nameMax) {
    throw invalid('name', 'length', `1 to ${PRINT_LIMITS.nameMax} characters`);
  }
  return name;
}

function checkedAddress(
  host: string | null | undefined,
  port: number | null | undefined,
): { host: string; port: number } {
  const trimmed = host?.trim() ?? '';
  if (!HOST_PATTERN.test(trimmed)) throw invalid('host', 'pattern', 'an IP address or host name');
  const chosen = port ?? PRINT_LIMITS.defaultPort;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 65535) {
    throw invalid('port', 'range', '1 to 65535');
  }
  return { host: trimmed, port: chosen };
}

/** The row without its key hash. */
function auditable(row: StationRow): Record<string, unknown> {
  const { keyHash: _hash, ...rest } = row;
  return rest;
}

export function view(row: StationRow): PrintStation {
  const seen = row.lastSeenAt;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    host: row.host,
    port: row.port,
    printerName: row.printerName,
    widthDots: row.widthDots === 384 ? 384 : 576,
    status: row.status,
    lastSeenAt: seen,
    online:
      row.status === 'ACTIVE' &&
      seen !== null &&
      Date.now() - seen.getTime() < PRINT_LIMITS.onlineSeconds * 1000,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
