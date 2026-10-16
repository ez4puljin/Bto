import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/public.decorator';
import { systemActor } from '../../identity';
import { HeartbeatDto, HeartbeatResponseDto, SyncBatchDto, SyncResponseDto } from '../dto/pos.dto';
import { CurrentEdge, EdgeTokenGuard } from '../guards/edge-token.guard';
import { PosAcceptService } from '../services/pos-accept.service';
import { type EdgeNode, PosEdgeNodesService } from '../services/pos-edge-nodes.service';
import { PosSettingsService } from '../services/pos-settings.service';
import { outcomeDto, settingsDto } from './mappers';
import { toSyncEvent } from './to-docs';

/**
 * What the store's edge calls (ADR-0063 #4): `@Public()` for the staff guard, the node's own token
 * for this guard. Documents are applied in the order sent, each in its own transaction; a batch
 * whose document fails for a reason the edge can cure by waiting is answered with that error, and
 * the edge sends the batch again (applied documents answer DUPLICATE then).
 */
@ApiTags('pos-sync')
@ApiSecurity('edge-token')
@Controller('pos/sync')
@Public()
@UseGuards(EdgeTokenGuard)
export class PosSyncController {
  constructor(
    private readonly accept: PosAcceptService,
    private readonly nodes: PosEdgeNodesService,
    private readonly settings: PosSettingsService,
  ) {}

  @Post('events')
  @HttpCode(200)
  @ApiOkResponse({ type: SyncResponseDto })
  async events(
    @CurrentEdge() node: EdgeNode,
    @Body() body: SyncBatchDto,
  ): Promise<SyncResponseDto> {
    const actor = systemActor(`edge:${node.code}`);
    const events = body.events.map(toSyncEvent);
    const results = [];
    for (const event of events) {
      results.push(outcomeDto(await this.accept.applyEvent(node, actor, event)));
    }
    await this.nodes.touchPush(node.id);
    return { results, serverTime: new Date().toISOString() };
  }

  @Post('heartbeat')
  @HttpCode(200)
  @ApiOkResponse({ type: HeartbeatResponseDto })
  async heartbeat(
    @CurrentEdge() node: EdgeNode,
    @Body() body: HeartbeatDto,
  ): Promise<HeartbeatResponseDto> {
    await this.nodes.heartbeat(node.id, {
      appVersion: body.appVersion ?? null,
      backlog: body.backlog,
      clockSkewMs: body.clockSkewMs ?? null,
      snapshotVersion: body.snapshotVersion ?? null,
    });
    return {
      edgeNodeId: node.id,
      code: node.code,
      serverTime: new Date().toISOString(),
      settings: settingsDto(await this.settings.get()),
    };
  }
}
