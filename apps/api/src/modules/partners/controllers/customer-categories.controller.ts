import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  CreateCustomerCategoryDto,
  CustomerCategoryDto,
  UpdateCustomerCategoryDto,
} from '../dto/customers.dto';
import { CustomerCategoriesService } from '../services/customer-categories.service';

/** Customer categories (ADR-0107): read with the customers, kept by whoever manages them. */
@ApiTags('partners')
@Controller('customer-categories')
export class CustomerCategoriesController {
  constructor(private readonly categories: CustomerCategoriesService) {}

  @Get()
  @RequirePermission('partners.customers.read')
  @ApiOkResponse({ type: [CustomerCategoryDto] })
  list(): Promise<CustomerCategoryDto[]> {
    return this.categories.list();
  }

  @Post()
  @RequirePermission('partners.customers.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: CustomerCategoryDto })
  create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateCustomerCategoryDto,
  ): Promise<CustomerCategoryDto> {
    return this.categories.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('partners.customers.manage')
  @ApiOkResponse({ type: CustomerCategoryDto })
  update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCustomerCategoryDto,
  ): Promise<CustomerCategoryDto> {
    return this.categories.update(ctx, id, body);
  }
}
