import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext } from '../../identity';
import { decodeEvent } from '../event-codec';
import type { SyncOutcome } from '../sale-doc';
import { posSyncRejections } from '../schema';
import { PosAcceptService } from './pos-accept.service';
import { PosEdgeNodesService } from './pos-edge-nodes.service';

/** An admin replays a refused document after fixing what it needed (a cashier, a till, prices). */
@Injectable()
export class PosReplayService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly nodes: PosEdgeNodesService,
    private readonly accept: PosAcceptService,
  ) {}

  async replay(ctx: AuthContext, rejectionId: number): Promise<SyncOutcome> {
    const [row] = await this.db
      .select()
      .from(posSyncRejections)
      .where(eq(posSyncRejections.id, rejectionId));
    if (!row) throw notFound('pos_sync_rejection', rejectionId);
    if (row.replayedAt) {
      throw new AppError('DOC_STATE_INVALID', `rejection ${rejectionId} was replayed`, {
        status: 'REPLAYED',
      });
    }
    const node = await this.nodes.get(row.edgeNodeId);
    const event = decodeEvent(row.kind, row.clientId, row.payload);
    const outcome = await this.accept.applyEvent(node, ctx, event);
    if (outcome.status !== 'REJECTED') {
      await this.db
        .update(posSyncRejections)
        .set({ replayedAt: sql`now()`, replayedBy: ctx.userId })
        .where(eq(posSyncRejections.id, rejectionId));
      await this.db.transaction((tx) =>
        this.audit.record(tx, ctx, {
          action: 'REPLAY',
          entity: 'pos_sync_rejections',
          entityId: rejectionId,
          after: { status: outcome.status, id: outcome.id, number: outcome.number },
        }),
      );
    }
    return outcome;
  }
}
