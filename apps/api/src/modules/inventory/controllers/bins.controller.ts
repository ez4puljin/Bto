import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  BinDto,
  BinListQueryDto,
  BinLookupQueryDto,
  BinPageDto,
  BinRangeRequestDto,
  BinRangeResultDto,
  CreateBinDto,
  ProductLocationDto,
  ProductLocationListDto,
  ProductLocationsQueryDto,
  SetProductHomeDto,
  SetProductLocationDto,
  UpdateBinDto,
} from '../dto/bins.dto';
import { BinsService } from '../services/bins.service';
import { ProductLocationsService } from '../services/product-locations.service';
import { toBinDto, toLocationDto } from './mappers';

const SETUP = 'inventory.setup.manage';
const LOCATIONS = 'inventory.locations.manage';

const decimalOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Decimal(value);

/** Bins: every signed-in user reads them (scanning); inventory.setup.manage creates and retires them. */
@ApiTags('inventory')
@Controller('bins')
export class BinsController {
  constructor(private readonly bins: BinsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: BinPageDto })
  async list(@Query() query: BinListQueryDto): Promise<BinPageDto> {
    const page = await this.bins.list(query);
    return { data: page.data.map(toBinDto), nextCursor: page.nextCursor };
  }

  /** A scanned shelf label in a warehouse. Declared before `:id`. */
  @Get('lookup')
  @Authenticated()
  @ApiOkResponse({ type: BinDto })
  async lookup(@Query() query: BinLookupQueryDto): Promise<BinDto> {
    return toBinDto(await this.bins.lookup(query.warehouseId, query.code));
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: BinDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<BinDto> {
    return toBinDto(await this.bins.get(id));
  }

  @Post()
  @RequirePermission(SETUP)
  @ApiCreatedResponse({ type: BinDto })
  async create(@CurrentUser() ctx: AuthContext, @Body() body: CreateBinDto): Promise<BinDto> {
    return toBinDto(await this.bins.create(ctx, body));
  }

  /** A block of shelves; with `dryRun` only the codes and the ones that already exist. */
  @Post('bulk')
  @HttpCode(200)
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: BinRangeResultDto })
  async bulk(
    @CurrentUser() ctx: AuthContext,
    @Body() body: BinRangeRequestDto,
  ): Promise<BinRangeResultDto> {
    return this.bins.createRange(ctx, {
      warehouseId: body.warehouseId,
      type: body.type,
      rows: { from: body.rowFrom, to: body.rowTo },
      racks: { from: body.rackFrom, to: body.rackTo },
      levels: { from: body.levelFrom, to: body.levelTo },
      ...(body.dryRun === undefined ? {} : { dryRun: body.dryRun }),
    });
  }

  @Patch(':id')
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: BinDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateBinDto,
  ): Promise<BinDto> {
    return toBinDto(await this.bins.update(ctx, id, body));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: BinDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BinDto> {
    return toBinDto(await this.bins.archive(ctx, id));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: BinDto })
  async restore(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BinDto> {
    return toBinDto(await this.bins.restore(ctx, id));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(SETUP)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.bins.remove(ctx, id);
  }
}

/** Fixed shelves, levels and home warehouses of products. */
@ApiTags('inventory')
@Controller('product-locations')
export class ProductLocationsController {
  constructor(private readonly locations: ProductLocationsService) {}

  /** By product (every warehouse), by several products, or by warehouse (paged). */
  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductLocationListDto })
  async list(@Query() query: ProductLocationsQueryDto): Promise<ProductLocationListDto> {
    if (query.productIds !== undefined) {
      if (query.productId !== undefined || query.warehouseId !== undefined) {
        throw invalid('productIds', 'alone', 'productIds without productId or warehouseId');
      }
      const rows = await this.locations.ofProductIds(query.productIds);
      return { data: rows.map(toLocationDto), nextCursor: null };
    }
    if (query.productId !== undefined) {
      const rows = await this.locations.ofProduct(query.productId);
      return { data: rows.map(toLocationDto), nextCursor: null };
    }
    if (query.warehouseId === undefined)
      throw invalid('productId', 'required', 'productId or warehouseId');
    const page = await this.locations.ofWarehouse({ ...query, warehouseId: query.warehouseId });
    return { data: page.data.map(toLocationDto), nextCursor: page.nextCursor };
  }

  @Put()
  @RequirePermission(LOCATIONS)
  @ApiOkResponse({ type: ProductLocationDto })
  async set(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SetProductLocationDto,
  ): Promise<ProductLocationDto> {
    const minQty = decimalOrNull(body.minQty);
    const maxQty = decimalOrNull(body.maxQty);
    return toLocationDto(
      await this.locations.set(ctx, {
        warehouseId: body.warehouseId,
        productId: body.productId,
        ...(body.defaultBinId === undefined ? {} : { defaultBinId: body.defaultBinId }),
        ...(minQty === undefined ? {} : { minQty }),
        ...(maxQty === undefined ? {} : { maxQty }),
      }),
    );
  }

  @Put('home')
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: ProductLocationListDto })
  async setHome(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SetProductHomeDto,
  ): Promise<ProductLocationListDto> {
    const rows = await this.locations.setHome(ctx, body.productId, body.warehouseId ?? null);
    return { data: rows.map(toLocationDto), nextCursor: null };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(LOCATIONS)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.locations.remove(ctx, id);
  }
}
