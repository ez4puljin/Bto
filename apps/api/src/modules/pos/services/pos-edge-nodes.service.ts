import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EDGE_CODE_PATTERN,
  POS_LIMITS,
  type PosStatus,
  TOKEN_PREFIX_LENGTH,
} from '@tugeel/shared/pos';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, OrgService } from '../../identity';
import { posEdgeNodes } from '../schema';

export interface EdgeNode {
  id: number;
  code: string;
  name: string;
  warehouseId: number;
  warehouseName: string | null;
  tokenPrefix: string | null;
  tokenIssuedAt: Date | null;
  appVersion: string | null;
  lastSeenAt: Date | null;
  lastPullAt: Date | null;
  lastPushAt: Date | null;
  backlog: number;
  clockSkewMs: number | null;
  snapshotVersion: string | null;
  /** The store PosAPI as the edge last reported it (ADR-0065). */
  posapiVersion: string | null;
  posapiLastSent: string | null;
  posapiLeftLotteries: number | null;
  posapiCheckedAt: Date | null;
  posapiError: string | null;
  status: PosStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeNodeInput {
  code: string;
  name: string;
  warehouseId: number;
}

export interface EdgeNodePatch {
  name?: string;
  warehouseId?: number;
  status?: PosStatus;
}

export interface Heartbeat {
  appVersion: string | null;
  backlog: number;
  clockSkewMs: number | null;
  snapshotVersion: string | null;
  /** Absent: the edge said nothing of a PosAPI (fake provider, older edge); the row keeps its facts. */
  posapi?: {
    version: string | null;
    lastSentDate: string | null;
    leftLotteries: number | null;
    checkedAt: Date;
    error: string | null;
  };
}

type NodeRow = typeof posEdgeNodes.$inferSelect;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * The store's edge servers (ADR-0063 #1, #6): one row per node; its token is shown once when
 * issued and kept here as a sha-256; the node authenticates with it on every sync call.
 */
@Injectable()
export class PosEdgeNodesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  async list(): Promise<EdgeNode[]> {
    const rows = await this.db.select().from(posEdgeNodes).orderBy(asc(posEdgeNodes.id));
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<EdgeNode> {
    const [row] = await executor.select().from(posEdgeNodes).where(eq(posEdgeNodes.id, id));
    if (!row) throw notFound('pos_edge_node', id);
    return this.view(row, executor);
  }

  async create(ctx: AuthContext, input: EdgeNodeInput): Promise<EdgeNode> {
    const code = input.code.trim().toUpperCase();
    if (!EDGE_CODE_PATTERN.test(code)) throw invalid('code', 'pattern', 'A-Z, 0-9, _ and -');
    const name = input.name.trim();
    if (name.length === 0 || name.length > POS_LIMITS.maxName) {
      throw invalid('name', 'length', `1 to ${POS_LIMITS.maxName} characters`);
    }
    const id = await inTransaction(this.db, async (tx) => {
      await this.assertStore(input.warehouseId, tx);
      const [row] = await tx
        .insert(posEdgeNodes)
        .values({ code, name, warehouseId: input.warehouseId, createdBy: ctx.userId })
        .onConflictDoNothing({ target: posEdgeNodes.code })
        .returning({ id: posEdgeNodes.id });
      if (!row) throw new AppError('DUPLICATE_VALUE', `edge node ${code} exists`, { code });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'pos_edge_nodes',
        entityId: row.id,
        after: { code, name, warehouseId: input.warehouseId },
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(ctx: AuthContext, id: number, patch: EdgeNodePatch): Promise<EdgeNode> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      if (patch.warehouseId !== undefined) await this.assertStore(patch.warehouseId, tx);
      const name = patch.name?.trim();
      if (name !== undefined && (name.length === 0 || name.length > POS_LIMITS.maxName)) {
        throw invalid('name', 'length', `1 to ${POS_LIMITS.maxName} characters`);
      }
      await tx
        .update(posEdgeNodes)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(posEdgeNodes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_edge_nodes',
        entityId: id,
        before: { name: before.name, warehouseId: before.warehouseId, status: before.status },
        after: patch,
      });
    });
    return this.get(id);
  }

  /** A new token for the node (the old one stops working); the raw token is returned once. */
  async issueToken(ctx: AuthContext, id: number): Promise<{ token: string; prefix: string }> {
    const secret = randomBytes(32).toString('base64url');
    const token = `tgs_${id}_${secret}`;
    const tokenHash = sha256(token);
    const prefix = tokenHash.slice(0, TOKEN_PREFIX_LENGTH);
    await inTransaction(this.db, async (tx) => {
      await this.get(id, tx);
      await tx
        .update(posEdgeNodes)
        .set({ tokenHash, tokenPrefix: prefix, tokenIssuedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(posEdgeNodes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'TOKEN_ISSUED',
        entity: 'pos_edge_nodes',
        entityId: id,
        after: { prefix },
      });
    });
    return { token, prefix };
  }

  /** The active node whose token this is, else null (the guard answers 401). */
  async authenticate(nodeId: number, secret: string): Promise<EdgeNode | null> {
    const [row] = await this.db.select().from(posEdgeNodes).where(eq(posEdgeNodes.id, nodeId));
    if (!row?.tokenHash || row.status !== 'ACTIVE') return null;
    const presented = Buffer.from(sha256(`tgs_${nodeId}_${secret}`), 'hex');
    const stored = Buffer.from(row.tokenHash, 'hex');
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
    return this.view(row);
  }

  /** What the edge reports about itself on every heartbeat (ADR-0063 #4). */
  async heartbeat(nodeId: number, beat: Heartbeat): Promise<void> {
    await this.db
      .update(posEdgeNodes)
      .set({
        appVersion: beat.appVersion,
        backlog: beat.backlog,
        clockSkewMs: beat.clockSkewMs,
        snapshotVersion: beat.snapshotVersion,
        ...(beat.posapi
          ? {
              posapiVersion: beat.posapi.version,
              posapiLastSent: beat.posapi.lastSentDate,
              posapiLeftLotteries: beat.posapi.leftLotteries,
              posapiCheckedAt: beat.posapi.checkedAt,
              posapiError: beat.posapi.error,
            }
          : {}),
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(posEdgeNodes.id, nodeId));
  }

  /** The edge pushed documents just now. */
  /** The edge pulled its snapshot (ADR-0067). */
  async touchPull(nodeId: number, version: string): Promise<void> {
    await this.db
      .update(posEdgeNodes)
      .set({ lastPullAt: new Date(), lastSeenAt: new Date(), snapshotVersion: version })
      .where(eq(posEdgeNodes.id, nodeId));
  }

  async touchPush(nodeId: number, executor: Db | Tx = this.db): Promise<void> {
    await executor
      .update(posEdgeNodes)
      .set({ lastPushAt: sql`now()`, lastSeenAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(posEdgeNodes.id, nodeId));
  }

  private async assertStore(warehouseId: number, tx: Tx): Promise<void> {
    const warehouse = await this.org.getWarehouse(warehouseId, tx);
    if (warehouse.kind !== 'STORE') {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'an edge serves a STORE warehouse', {
        kind: warehouse.kind,
      });
    }
  }

  private async view(row: NodeRow, executor: Db | Tx = this.db): Promise<EdgeNode> {
    const warehouse = await this.org.getWarehouse(row.warehouseId, executor).catch(() => null);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      warehouseId: row.warehouseId,
      warehouseName: warehouse?.name ?? null,
      tokenPrefix: row.tokenPrefix,
      tokenIssuedAt: row.tokenIssuedAt,
      appVersion: row.appVersion,
      lastSeenAt: row.lastSeenAt,
      lastPullAt: row.lastPullAt,
      lastPushAt: row.lastPushAt,
      backlog: row.backlog,
      clockSkewMs: row.clockSkewMs,
      snapshotVersion: row.snapshotVersion,
      posapiVersion: row.posapiVersion,
      posapiLastSent: row.posapiLastSent,
      posapiLeftLotteries: row.posapiLeftLotteries,
      posapiCheckedAt: row.posapiCheckedAt,
      posapiError: row.posapiError,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
