import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CreateSupplierCategoryDto,
  SupplierCategoryDto,
  UpdateSupplierCategoryDto,
} from '../dto/suppliers.dto';
import { SupplierCategoriesService } from '../services/supplier-categories.service';

const MANAGE = 'partners.suppliers.manage';

/** Supplier categories (ADR-0161): every signed-in user reads them, as they read suppliers. */
@ApiTags('partners')
@Controller('supplier-categories')
export class SupplierCategoriesController {
  constructor(private readonly categories: SupplierCategoriesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: [SupplierCategoryDto] })
  list(): Promise<SupplierCategoryDto[]> {
    return this.categories.list();
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: SupplierCategoryDto })
  create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateSupplierCategoryDto,
  ): Promise<SupplierCategoryDto> {
    return this.categories.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SupplierCategoryDto })
  update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSupplierCategoryDto,
  ): Promise<SupplierCategoryDto> {
    return this.categories.update(ctx, id, body);
  }
}
