import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Authenticated,
  type AuthContext,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  BasePriceEventDto,
  BasePriceViewDto,
  LocationPriceRuleDto,
  LocationPriceRuleInputDto,
  ManualBasePriceInputDto,
  SupplierPriceRuleDto,
  SupplierPriceRuleInputDto,
} from '../dto/supplier-pricing.dto';
import { SupplierPricingService } from '../services/supplier-pricing.service';

@ApiTags('pricing')
@Controller('pricing')
export class SupplierPricingController {
  constructor(private readonly pricing: SupplierPricingService) {}

  @Get('supplier-rules')
  @RequirePermission('pricing.manage')
  @ApiOkResponse({ type: [SupplierPriceRuleDto] })
  supplierRules() {
    return this.pricing.supplierRules();
  }

  @Put('supplier-rules/:supplierId')
  @RequirePermission('pricing.manage')
  @Idempotent()
  @ApiOkResponse({ type: SupplierPriceRuleDto })
  setSupplier(
    @CurrentUser() ctx: AuthContext,
    @Param('supplierId', ParseIntPipe) id: number,
    @Body() body: SupplierPriceRuleInputDto,
  ) {
    return this.pricing.setSupplierRule(ctx, id, body);
  }

  @Get('location-rules')
  @Authenticated()
  @ApiOkResponse({ type: [LocationPriceRuleDto] })
  locationRules() {
    return this.pricing.locationRules();
  }

  @Put('location-rules/:warehouseId')
  @RequirePermission('pricing.manage')
  @Idempotent()
  @ApiOkResponse({ type: LocationPriceRuleDto })
  setLocation(
    @CurrentUser() ctx: AuthContext,
    @Param('warehouseId', ParseIntPipe) id: number,
    @Body() body: LocationPriceRuleInputDto,
  ) {
    return this.pricing.setLocationRule(ctx, id, body);
  }

  @Get('base-prices/:productId')
  @Authenticated()
  @ApiOkResponse({ type: BasePriceViewDto })
  base(@CurrentUser() ctx: AuthContext, @Param('productId', ParseIntPipe) id: number) {
    return this.pricing.baseView(ctx, id);
  }

  @Put('base-prices/:productId')
  @RequirePermission('pricing.prices.manage')
  @Idempotent()
  @ApiOkResponse({ type: BasePriceViewDto })
  manual(
    @CurrentUser() ctx: AuthContext,
    @Param('productId', ParseIntPipe) id: number,
    @Body() body: ManualBasePriceInputDto,
  ) {
    return this.pricing.setManual(ctx, id, body);
  }

  @Get('receipt-price-changes/:receiptId')
  @Authenticated()
  @ApiOkResponse({ type: [BasePriceEventDto] })
  receipt(@CurrentUser() ctx: AuthContext, @Param('receiptId', ParseIntPipe) id: number) {
    return this.pricing.receiptChanges(ctx, id);
  }
}
