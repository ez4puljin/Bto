import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiSchema, ApiTags } from '@nestjs/swagger';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  BinContentDto,
  LowStockPageDto,
  LowStockQueryDto,
  ProductStockDetailDto,
  ProductStockDto,
  ProductStockPageDto,
  ReconciliationStatusDto,
  StockMovementPageDto,
  StockMovementQueryDto,
  StockQueryDto,
  StockQueryPageDto,
  StockQueryRequestDto,
} from '../dto/stock.dto';
import {
  type SimilarMethod,
  SimilarProductsFlowService,
} from '../services/similar-products-flow.service';
import { StockQueryService } from '../services/stock-query.service';
import {
  toBinContentDto,
  toLowStockRowDto,
  toProductStockDetailDto,
  toProductStockDto,
  toReconciliationRunDto,
  toStockMovementDto,
} from './mappers';

const COSTS = 'inventory.costs.manage';
const SIMILAR_METHODS: readonly SimilarMethod[] = ['AI', 'NAME'];

/** «Төстэй бараа (AI)» (ADR-0231): the product and those of its kind and size, with their stock. */
@ApiSchema({ name: 'SimilarProducts' })
class SimilarProductsDto {
  @ApiProperty({
    enum: SIMILAR_METHODS,
    description: 'AI: chosen by the model; NAME: by the pre-filter',
  })
  method: SimilarMethod;
  @ApiProperty({ description: 'The product asked about: the first row' }) productId: number;
  @ApiProperty({ type: [ProductStockDto] }) data: ProductStockDto[];
}

/** Stock balances for every signed-in user; costs only reach holders of inventory.costs.manage. */
@ApiTags('inventory')
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockQueryService,
    private readonly similar: SimilarProductsFlowService,
  ) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductStockPageDto })
  async overview(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockQueryDto,
  ): Promise<ProductStockPageDto> {
    const page = await this.stock.overview(query);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((row) => toProductStockDto(row, withCosts)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * The stock list with the product list's filters (owner 2026-11-10): category, stage, conditions
   * on the product and a saved segment, in the catalog's order, with the total on the first page.
   */
  @Post('query')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: StockQueryPageDto })
  async query(
    @CurrentUser() ctx: AuthContext,
    @Body() body: StockQueryRequestDto,
  ): Promise<StockQueryPageDto> {
    const page = await this.stock.list(body);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((row) => toProductStockDto(row, withCosts)),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  /** Movement history (SPEC §8.2 #1): ledger rows newest first, with document numbers. */
  @Get('movements')
  @Authenticated()
  @ApiOkResponse({ type: StockMovementPageDto })
  async movements(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockMovementQueryDto,
  ): Promise<StockMovementPageDto> {
    const page = await this.stock.movements(query);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((row) => toStockMovementDto(row, withCosts)),
      nextCursor: page.nextCursor,
    };
  }

  /** The low-stock list of a warehouse (SPEC §8.2 #4, ADR-0039): out of stock first. */
  @Get('low')
  @Authenticated()
  @ApiOkResponse({ type: LowStockPageDto })
  async low(@Query() query: LowStockQueryDto): Promise<LowStockPageDto> {
    const page = await this.stock.lowStock(query);
    return { data: page.data.map(toLowStockRowDto), nextCursor: page.nextCursor };
  }

  @Get('products/:id')
  @Authenticated()
  @ApiOkResponse({ type: ProductStockDetailDto })
  async product(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductStockDetailDto> {
    return toProductStockDetailDto(await this.stock.ofProduct(id), ctx.permissions.has(COSTS));
  }

  /**
   * Products of the same kind and pack size as this one, chosen by the model among the pre-filter's
   * candidates, or by the pre-filter alone without a model (ADR-0231), with their stock.
   */
  @Get('similar/:productId')
  @Authenticated()
  @ApiOkResponse({ type: SimilarProductsDto })
  async similarTo(
    @CurrentUser() ctx: AuthContext,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<SimilarProductsDto> {
    const result = await this.similar.of(ctx, productId);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      method: result.method,
      productId: result.productId,
      data: result.data.map((row) => toProductStockDto(row, withCosts)),
    };
  }

  @Get('bins/:id')
  @Authenticated()
  @ApiOkResponse({ type: BinContentDto })
  async bin(@Param('id', ParseIntPipe) id: number): Promise<BinContentDto> {
    return toBinContentDto(await this.stock.ofBin(id));
  }

  /** The last check of the caches against the ledger, for the admin banner. */
  @Get('reconciliation/latest')
  @RequirePermission('inventory.setup.manage')
  @ApiOkResponse({ type: ReconciliationStatusDto })
  async reconciliation(): Promise<ReconciliationStatusDto> {
    const run = await this.stock.latestReconciliation();
    return { lastRun: run ? toReconciliationRunDto(run) : null };
  }
}
