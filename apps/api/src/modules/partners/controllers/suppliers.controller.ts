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
import { invalid } from '../../../common/errors/app-error';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import { ContactDto, ContactRequestDto, NextCodeDto } from '../dto/common.dto';
import {
  CreateSupplierDto,
  LinkRequestDto,
  ProductSupplierLinkDto,
  ProductSupplierListDto,
  ProductSuppliersQueryDto,
  SupplierDetailDto,
  SupplierListQueryDto,
  SupplierPageDto,
  SupplierProductPageDto,
  UpdateSupplierDto,
} from '../dto/suppliers.dto';
import { SupplierContactsService } from '../services/contacts.service';
import { ProductSuppliersService } from '../services/product-suppliers.service';
import { type SupplierDetail, SuppliersService } from '../services/suppliers.service';
import { toContactDto } from './mappers';

const MANAGE = 'partners.suppliers.manage';

function toSupplierDetailDto(detail: SupplierDetail): SupplierDetailDto {
  return {
    ...detail,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    contacts: detail.contacts.map(toContactDto),
  };
}

/** Suppliers: every signed-in user reads them (receiving); partners.suppliers.manage edits them. */
@ApiTags('partners')
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly contacts: SupplierContactsService,
    private readonly links: ProductSuppliersService,
  ) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: SupplierPageDto })
  async list(@Query() query: SupplierListQueryDto): Promise<SupplierPageDto> {
    return this.suppliers.listItems(query);
  }

  /** Declared before `:id`, so "next-code" never reaches ParseIntPipe. */
  @Get('next-code')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NextCodeDto })
  async nextCode(): Promise<NextCodeDto> {
    return { code: await this.suppliers.nextCode() };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: SupplierDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<SupplierDetailDto> {
    return toSupplierDetailDto(await this.suppliers.get(id));
  }

  /** Idempotent: the server allocates the code when it is omitted, so a retry must not add a twin. */
  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: SupplierDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateSupplierDto,
  ): Promise<SupplierDetailDto> {
    return toSupplierDetailDto(await this.suppliers.create(ctx, body));
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SupplierDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSupplierDto,
  ): Promise<SupplierDetailDto> {
    return toSupplierDetailDto(await this.suppliers.update(ctx, id, body));
  }

  @Post(':id/contacts')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ContactDto })
  async addContact(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ContactRequestDto,
  ): Promise<ContactDto> {
    return toContactDto(await this.contacts.add(ctx, id, body));
  }

  @Get(':id/products')
  @Authenticated()
  @ApiOkResponse({ type: SupplierProductPageDto })
  async products(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PageQueryDto,
  ): Promise<SupplierProductPageDto> {
    await this.suppliers.get(id);
    const page = await this.links.productsOf(id, query);
    return {
      data: page.data.map((row) => ({
        linkId: row.linkId,
        isMain: row.isMain,
        product: {
          id: row.product.id,
          sku: row.product.sku,
          name: row.product.name,
          status: row.product.status,
          thumbUrl: row.product.thumbUrl,
          baseUnitName: row.product.baseUnit.uomName,
        },
      })),
      nextCursor: page.nextCursor,
    };
  }
}

@ApiTags('partners')
@Controller('supplier-contacts')
export class SupplierContactsController {
  constructor(private readonly contacts: SupplierContactsService) {}

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ContactDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ContactRequestDto,
  ): Promise<ContactDto> {
    return toContactDto(await this.contacts.update(ctx, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.contacts.remove(ctx, id);
  }
}

/** Product ↔ supplier links (ADR-0032), kept in the partners namespace. */
@ApiTags('partners')
@Controller('product-suppliers')
export class ProductSuppliersController {
  constructor(private readonly links: ProductSuppliersService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductSupplierListDto })
  async ofProduct(@Query() query: ProductSuppliersQueryDto): Promise<ProductSupplierListDto> {
    if ((query.productId === undefined) === (query.productIds === undefined)) {
      throw invalid('productId', 'exactlyOne', 'productId or productIds, not both');
    }
    const ids = query.productIds ?? (query.productId === undefined ? [] : [query.productId]);
    return { data: await this.links.ofProductIds(ids), nextCursor: null };
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ProductSupplierLinkDto })
  async link(
    @CurrentUser() ctx: AuthContext,
    @Body() body: LinkRequestDto,
  ): Promise<ProductSupplierLinkDto> {
    return this.links.link(ctx, body.productId, body.supplierId);
  }

  @Post(':id/main')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ProductSupplierLinkDto })
  async setMain(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductSupplierLinkDto> {
    return this.links.setMain(ctx, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async unlink(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.links.unlink(ctx, id);
  }
}
