import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'InventoryAttentionLowStock' })
export class LowStockAttentionDto {
  @ApiProperty({ description: 'Low-stock lines over the caller’s warehouses, capped' })
  count: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The warehouse with the most low-stock lines (the tile opens its list)',
  })
  warehouseId: number | null;
}

/** The work waiting for the caller in inventory (ADR-0047 #7); each count stops at `cap`. */
@ApiSchema({ name: 'InventoryAttention' })
export class InventoryAttentionDto {
  @ApiProperty({ description: 'Requests the caller’s warehouses are to ship' })
  transfersToShip: number;
  @ApiProperty({ description: 'Shipments on their way to the caller’s warehouses' })
  transfersToReceive: number;
  @ApiProperty({
    description: 'Request groups the caller’s warehouses sent, counted by the store, to confirm',
  })
  transfersToConfirm: number;
  @ApiProperty({ description: 'Adjustments waiting for approval (approvers)' })
  adjustmentsToApprove: number;
  @ApiProperty({ description: 'Stocktakes waiting for review (approvers)' })
  stocktakesToReview: number;
  @ApiProperty({ description: 'Posted receipts waiting for their costs (cost holders)' })
  receiptsToCost: number;
  @ApiProperty({ type: LowStockAttentionDto }) lowStock: LowStockAttentionDto;
  @ApiProperty({ example: 100, description: 'Counts stop here; show «99+» at the cap' })
  cap: number;
}
