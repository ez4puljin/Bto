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

  /** The live segments each record is in, by name ({} without the segments module). */
  async namesOf(
    ctx: AuthContext,
    entity: PartnerSetEntity,
    recordIds: readonly number[],
  ): Promise<Map<number, { id: number; name: string }[]>> {
    const result = new Map<number, { id: number; name: string }[]>();
    if (!this.resolver || recordIds.length === 0) return result;
    const wanted = new Set(recordIds);
    for (const segment of await this.resolver.memberships(ctx, entity)) {
      for (const id of segment.ids) {
        if (!wanted.has(id)) continue;
        const names = result.get(id) ?? [];
        names.push({ id: segment.id, name: segment.name });
        result.set(id, names);
      }
    }
    return result;
  }
}
