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
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  BrandDto,
  BrandInputDto,
  BrandListDto,
  CategoryDto,
  CategoryListDto,
  CreateCategoryDto,
  CreateUomDto,
  UomDto,
  UomListDto,
  UpdateCategoryDto,
  UpdateUomDto,
} from '../dto/masters.dto';
import { type BrandView, BrandsService } from '../services/brands.service';
import { CategoriesService } from '../services/categories.service';
import { UomsService } from '../services/uoms.service';
import { toCategoryDto, toUomDto } from './mappers';

const MANAGE = 'catalog.products.manage';
const toBrandDto = (row: BrandView): BrandDto => ({
  id: row.id,
  name: row.name,
  productCount: row.productCount,
});

@ApiTags('catalog')
@Controller('uoms')
export class UomsController {
  constructor(private readonly uoms: UomsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: UomListDto })
  async list(): Promise<UomListDto> {
    return { data: (await this.uoms.list()).map(toUomDto), nextCursor: null };
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: UomDto })
  async create(@CurrentUser() ctx: AuthContext, @Body() body: CreateUomDto): Promise<UomDto> {
    return toUomDto(await this.uoms.create(ctx, body));
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: UomDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUomDto,
  ): Promise<UomDto> {
    return toUomDto(await this.uoms.update(ctx, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.uoms.remove(ctx, id);
  }
}

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: CategoryListDto })
  async list(): Promise<CategoryListDto> {
    return { data: (await this.categories.list()).map(toCategoryDto), nextCursor: null };
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: CategoryDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateCategoryDto,
  ): Promise<CategoryDto> {
    const row = await this.categories.create(ctx, body);
    return toCategoryDto({ ...row, productCount: 0, childCount: 0 });
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CategoryDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    await this.categories.update(ctx, id, body);
    const view = (await this.categories.list()).find((row) => row.id === id);
    if (!view) throw new Error(`category ${id} vanished`);
    return toCategoryDto(view);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.categories.remove(ctx, id);
  }
}

@ApiTags('catalog')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: BrandListDto })
  async list(): Promise<BrandListDto> {
    return { data: (await this.brands.list()).map(toBrandDto), nextCursor: null };
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: BrandDto })
  async create(@CurrentUser() ctx: AuthContext, @Body() body: BrandInputDto): Promise<BrandDto> {
    return toBrandDto({ ...(await this.brands.create(ctx, body)), productCount: 0 });
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: BrandDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: BrandInputDto,
  ): Promise<BrandDto> {
    await this.brands.update(ctx, id, body);
    const view = (await this.brands.list()).find((row) => row.id === id);
    if (!view) throw new Error(`brand ${id} vanished`);
    return toBrandDto(view);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.brands.remove(ctx, id);
  }
}
