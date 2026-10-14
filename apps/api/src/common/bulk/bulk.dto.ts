import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MAX_BULK_PRODUCTS } from '@tugeel/shared/catalog';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

/**
 * The ticked products of a bulk change (ADR-0051): 1–500 ids without repeats. Each owner module
 * extends it with its field; an unknown id refuses the whole request (404).
 */
export class BulkProductsDto {
  @ApiProperty({ type: [Number], description: `1–${MAX_BULK_PRODUCTS} products, no repeats` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_PRODUCTS)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

/** What a bulk change did: the products it changed and those that already were so. */
@ApiSchema({ name: 'BulkResult' })
export class BulkResultDto {
  @ApiProperty({ type: [Number] }) changed: number[];
  @ApiProperty({ type: [Number] }) unchanged: number[];
}
