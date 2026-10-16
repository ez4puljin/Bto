import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { parseEdgeToken } from '@tugeel/shared/pos';
import type { Request } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { type EdgeNode, PosEdgeNodesService } from '../services/pos-edge-nodes.service';

export interface EdgeRequest {
  edgeNode?: EdgeNode;
}

/**
 * The store's edge is not a staff member: its routes are `@Public()` for the global guard and
 * carry this guard instead (ADR-0063 #6), which checks `Authorization: Bearer tgs_<node>_<secret>`
 * against the node's stored hash (the webhook pattern of architecture §6).
 */
@Injectable()
export class EdgeTokenGuard implements CanActivate {
  constructor(private readonly nodes: PosEdgeNodesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & EdgeRequest>();
    const header = request.headers.authorization;
    const raw = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const parsed = parseEdgeToken(raw);
    if (!parsed) throw new AppError('UNAUTHORIZED', 'missing edge token', { reason: 'TOKEN' });
    const node = await this.nodes.authenticate(parsed.nodeId, parsed.secret);
    if (!node) throw new AppError('UNAUTHORIZED', 'edge token refused', { reason: 'TOKEN' });
    request.edgeNode = node;
    return true;
  }
}

/** The edge node the guard resolved for this request. */
export const CurrentEdge = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EdgeNode => {
    const request = context.switchToHttp().getRequest<EdgeRequest>();
    if (!request.edgeNode) throw new Error('@CurrentEdge() needs EdgeTokenGuard on the route');
    return request.edgeNode;
  },
);
