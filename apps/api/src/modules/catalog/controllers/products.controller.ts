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
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import { BulkResultDto } from '../../../common/bulk/bulk.dto';
import {
  AddBarcodeDto,
  BarcodeDto,
  BulkCategoryDto,
  BulkStatusDto,
  CreateProductDto,
  NewUnitDto,
  NextSkuDto,
  NextSkuQueryDto,
  ProductDetailDto,
  ProductIdsDto,
  ProductIdsRequestDto,
  ProductListItemDto,
  ProductListQueryDto,
  ProductLookupQueryDto,
  ProductPageDto,
  ProductQueryPageDto,
  ProductQueryRequestDto,
  ProductUnitDto,
  SupersedeUnitDto,
  UpdateProductDto,
  UpdateProductEbarimtDto,
  UpdateUnitDto,
} from '../dto/products.dto';
import { BarcodeService } from '../services/barcode.service';
import { ProductBulkService } from '../services/product-bulk.service';
import { ProductEbarimtService } from '../services/product-ebarimt.service';
import { ProductQueryService } from '../services/product-query.service';
import { SkuRangesService } from '../services/sku-ranges.service';
import {
  type NewUnitInput,
  type ProductPatch,
  ProductsService,
} from '../services/products.service';
import { toDecimal } from '../services/support';
import { UnitsService } from '../services/units.service';
import { toBarcodeDto, toProductDetailDto, toProductListItemDto, toUnitDto } from './mappers';

const MANAGE = 'catalog.products.manage';
const EBARIMT = 'catalog.ebarimt.manage';
const REGISTER = 'catalog.products.register';

const toUnitInput = (unit: NewUnitDto): NewUnitInput => ({
  ...unit,
  factorToBase: toDecimal(unit.factorToBase),
});

@ApiTags('catalog')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly ebarimt: ProductEbarimtService,
    private readonly ranges: SkuRangesService,
    private readonly productQuery: ProductQueryService,
    private readonly bulk: ProductBulkService,
  ) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductPageDto })
  async list(@Query() query: ProductListQueryDto): Promise<ProductPageDto> {
    const page = await this.products.listItems(query);
    return { data: page.data.map(toProductListItemDto), nextCursor: page.nextCursor };
  }

  /**
   * A picker's quick search (ADR-0099 #3): active products only, the list's match and order, units
   * and barcodes without pictures, at most 30; `supplierId` keeps that supplier's products
   * (ADR-0103). Declared before `:id`.
   */
  @Get('lookup')
  @Authenticated()
  @ApiOkResponse({ type: [ProductListItemDto] })
  async lookup(@Query() query: ProductLookupQueryDto): Promise<ProductListItemDto[]> {
    // A supplier's products through the segments' resolver (partners owns the links, ADR-0103).
    const within =
      query.supplierId === undefined
        ? null
        : await this.productQuery.within({
            where: {
              match: 'ALL',
              groups: [
                {
                  match: 'ALL',
                  conditions: [{ field: 'supplier', op: 'IN', ids: [query.supplierId] }],
                },
              ],
            },
          });
    return (await this.products.lookup(query.q, query.limit ?? 20, within)).map(
      toProductListItemDto,
    );
  }

  /**
   * The product list screen (ADR-0049 #4): the list's filters plus conditions on other modules'
   * data or a saved segment, with the total on the first page. Declared before `:id`.
   */
  @Post('query')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: ProductQueryPageDto })
  async query(@Body() body: ProductQueryRequestDto): Promise<ProductQueryPageDto> {
    const page = await this.productQuery.query(body);
    return {
      data: page.data.map(toProductListItemDto),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  /**
   * Every product the list's filters keep, in the list's order, at most 20,000 (ADR-0052):
   * «Таарсан бүх N-ийг сонгох». 422 SELECTION_TOO_LARGE above that, with the count.
   */
  @Post('query/ids')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: ProductIdsDto })
  async queryIds(@Body() body: ProductIdsRequestDto): Promise<ProductIdsDto> {
    return { ids: await this.productQuery.selectableIds(body) };
  }

  /** Sets the status of ticked products (ADR-0051 #1). */
  @Post('bulk/status')
  @RequirePermission(MANAGE)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: BulkResultDto })
  bulkStatus(@CurrentUser() ctx: AuthContext, @Body() body: BulkStatusDto): Promise<BulkResultDto> {
    return this.bulk.setStatus(ctx, body.productIds, body.status);
  }

  /** Moves ticked products to a category (ADR-0051 #1). */
  @Post('bulk/category')
  @RequirePermission(MANAGE)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: BulkResultDto })
  bulkCategory(
    @CurrentUser() ctx: AuthContext,
    @Body() body: BulkCategoryDto,
  ): Promise<BulkResultDto> {
    return this.bulk.setCategory(ctx, body.productIds, body.categoryId);
  }

  /**
   * The code to suggest for a new product of a category (ADR-0044 #1): from its range, else past
   * every range. Declared before `:id`, so "next-sku" never reaches ParseIntPipe.
   */
  @Get('next-sku')
  @RequirePermission(REGISTER)
  @ApiOkResponse({ type: NextSkuDto })
  async nextSku(@Query() query: NextSkuQueryDto): Promise<NextSkuDto> {
    return { sku: await this.ranges.suggest(query.categoryId) };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: ProductDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<ProductDetailDto> {
    return toProductDetailDto(await this.products.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ProductDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateProductDto,
  ): Promise<ProductDetailDto> {
    const created = await this.products.create(ctx, {
      ...body,
      weightKg: body.weightKg ? toDecimal(body.weightKg) : null,
      units: body.units?.map(toUnitInput),
    });
    return toProductDetailDto(created);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ProductDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProductDto,
  ): Promise<ProductDetailDto> {
    const { weightKg, ...rest } = body;
    const patch: ProductPatch = {
      ...rest,
      ...(weightKg === undefined
        ? {}
        : { weightKg: weightKg === null ? null : toDecimal(weightKg) }),
    };
    return toProductDetailDto(await this.products.update(ctx, id, patch));
  }

  /** The accountant's e-Barimt data, apart from the product's other fields (ADR-0044 #6). */
  @Patch(':id/ebarimt')
  @RequirePermission(EBARIMT)
  @ApiOkResponse({ type: ProductDetailDto })
  async updateEbarimt(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProductEbarimtDto,
  ): Promise<ProductDetailDto> {
    return toProductDetailDto(await this.ebarimt.update(ctx, id, body));
  }
}

@ApiTags('catalog')
@Controller()
export class ProductUnitsController {
  constructor(
    private readonly products: ProductsService,
    private readonly units: UnitsService,
    private readonly barcodes: BarcodeService,
  ) {}

  @Post('products/:id/units')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ProductDetailDto })
  async add(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: NewUnitDto,
  ): Promise<ProductDetailDto> {
    await this.units.add(ctx, id, toUnitInput(body));
    return toProductDetailDto(await this.products.get(id));
  }

  @Patch('product-units/:id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ProductUnitDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUnitDto,
  ): Promise<ProductUnitDto> {
    const row = await this.units.update(ctx, id, body);
    return this.unitView(row.productId, row.id);
  }

  /** A new factor: the unit is superseded by a new row that takes its flags and barcodes (ADR-0008). */
  @Post('product-units/:id/supersede')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: ProductUnitDto })
  async supersede(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SupersedeUnitDto,
  ): Promise<ProductUnitDto> {
    const row = await this.units.supersede(ctx, id, toDecimal(body.factorToBase));
    return this.unitView(row.productId, row.id);
  }

  @Post('product-units/:id/retire')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: ProductUnitDto })
  async retire(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductUnitDto> {
    const row = await this.units.retire(ctx, id);
    return this.unitView(row.productId, row.id);
  }

  @Post('product-units/:id/barcodes')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: BarcodeDto })
  async addBarcode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AddBarcodeDto,
  ): Promise<BarcodeDto> {
    return toBarcodeDto(await this.barcodes.add(ctx, id, body.code));
  }

  @Post('product-units/:id/internal-barcode')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: BarcodeDto })
  async internalBarcode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BarcodeDto> {
    return toBarcodeDto(await this.barcodes.generateInternal(ctx, id));
  }

  @Post('product-barcodes/:id/primary')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: BarcodeDto })
  async primary(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BarcodeDto> {
    return toBarcodeDto(await this.barcodes.setPrimary(ctx, id));
  }

  @Delete('product-barcodes/:id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async removeBarcode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.barcodes.remove(ctx, id);
  }

  private async unitView(productId: number, unitId: number): Promise<ProductUnitDto> {
    const unit = (await this.products.get(productId)).units.find((row) => row.id === unitId);
    if (!unit) throw new Error(`unit ${unitId} vanished`);
    return toUnitDto(unit);
  }
}
