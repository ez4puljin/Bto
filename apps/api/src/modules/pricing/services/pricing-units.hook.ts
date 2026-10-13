import { Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import type { UnitSupersededHook } from '../../catalog';
import { systemActor } from '../../identity';
import { DiscountProgramsService } from './discount-programs.service';
import { UnitPricesService } from './unit-prices.service';

/**
 * Bound to catalog's UNIT_SUPERSEDED_HOOK and run inside the supersede transaction (ADR-0041 #1,
 * replacing ADR-0008 #4): the old unit's prices end today and its programs stop. Nothing is copied
 * to the new unit, whose factor differs: it takes its base unit's price × factor until the admin
 * gives it its own, so a customer never pays the old box's price for a smaller box.
 */
@Injectable()
export class PricingUnitsHook implements UnitSupersededHook {
  constructor(
    private readonly prices: UnitPricesService,
    private readonly programs: DiscountProgramsService,
  ) {}

  async onUnitSuperseded(tx: Tx, change: { oldUnitId: number; newUnitId: number }): Promise<void> {
    const today = businessDate();
    const actor = systemActor('unit-superseded');
    await this.prices.closeUnitInTx(tx, actor, change.oldUnitId, today);
    await this.programs.closeForUnitInTx(tx, actor, change.oldUnitId, today);
  }
}
