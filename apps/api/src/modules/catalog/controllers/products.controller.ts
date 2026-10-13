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
import {
  AddBarcodeDto,
  BarcodeDto,
  CreateProductDto,
  NewUnitDto,
  NextSkuDto,
  ProductDetailDto,
  ProductListQueryDto,
  ProductPageDto,
  ProductUnitDto,
  SupersedeUnitDto,
  UpdateProductDto,
  UpdateProductEbarimtDto,
  UpdateUnitDto,
} from '../dto/products.dto';
import { BarcodeService } from '../services/barcode.service';
import { ProductEbarimtService } from '../services/product-ebarimt.service';
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
  ) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductPageDto })
  async list(@Query() query: ProductListQueryDto): Promise<ProductPageDto> {
    const page = await this.products.listItems(query);
    return { data: page.data.map(toProductListItemDto), nextCursor: page.nextCursor };
  }

  /** Declared before `:id`, so "next-sku" never reaches ParseIntPipe. */
  @Get('next-sku')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NextSkuDto })
  async nextSku(): Promise<NextSkuDto> {
    return { sku: await this.products.nextSku() };
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
