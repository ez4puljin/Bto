import { Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import type { UnitSupersededHook } from '../../catalog';
import { systemActor } from '../../identity';
import { DiscountProgramsService } from './discount-programs.service';

/**
 * Bound to catalog's UNIT_SUPERSEDED_HOOK and run inside the supersede transaction (ADR-0041 #6,
 * replacing ADR-0008 #4): the old unit's discount programs stop, and nothing is copied to the new
 * unit, whose factor differs. Prices need nothing (ADR-0048 #2): a product's whole pack is a unit
 * of measure, so a box whose count changes stays the whole pack.
 */
@Injectable()
export class PricingUnitsHook implements UnitSupersededHook {
  constructor(private readonly programs: DiscountProgramsService) {}

  async onUnitSuperseded(tx: Tx, change: { oldUnitId: number; newUnitId: number }): Promise<void> {
    await this.programs.closeForUnitInTx(
      tx,
      systemActor('unit-superseded'),
      change.oldUnitId,
      businessDate(),
    );
  }
}
