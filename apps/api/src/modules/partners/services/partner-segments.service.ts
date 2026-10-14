import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import { PARTNER_SET_RESOLVER, type PartnerSetEntity, type PartnerSetResolver } from '../hooks';

/**
 * The customers or suppliers a saved segment keeps (ADR-0049 #4), through the resolver the
 * segments module binds. Without one a segment filter is refused (503), never ignored.
 */
@Injectable()
export class PartnerSegmentsService implements OnModuleInit {
  private resolver: PartnerSetResolver | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    try {
      this.resolver = this.moduleRef.get<PartnerSetResolver>(PARTNER_SET_RESOLVER, {
        strict: false,
      });
    } catch {
      this.resolver = null;
    }
  }

  /** Ascending ids the segment keeps; null without a segment. */
  async within(
    ctx: AuthContext,
    entity: PartnerSetEntity,
    segmentId: number | undefined,
  ): Promise<number[] | null> {
    if (segmentId === undefined) return null;
    if (!this.resolver) {
      throw new AppError('SERVICE_UNAVAILABLE', 'segment filters are not available');
    }
    return this.resolver.ids(ctx, entity, segmentId);
  }
}
