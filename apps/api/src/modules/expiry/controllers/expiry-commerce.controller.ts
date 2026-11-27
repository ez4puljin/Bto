import { ExpirySalesQueryService } from '../services/expiry-sales-query.service';
import { PageQueryDto } from '../../../common/pagination/page';
import { ExpiryPosExceptionsService } from '../services/expiry-pos-exceptions.service';
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  ExpirySourceRequestDto,
  ExpirySalesPageDto,
  ExpiryExceptionAcknowledgementDto,
  ExpiryExceptionsDto,
  ExpiryMarkdownRequestDto,
  ExpiryExceptionResolutionDto,
  ExpiryBarcodeQueryDto,
  ExpiryCommerceDto,
  ExpiryReceiptSourcesDto,
  ExpiryContextPricesDto,
  ExpirySaleOfferDto,
} from '../dto/expiry-commerce.dto';
import { ExpiryCommerceService } from '../services/expiry-commerce.service';

@ApiTags('expiry')
@Controller('expiry')
export class ExpiryCommerceController {
  constructor(
    private readonly commerce: ExpiryCommerceService,
    private readonly sales: ExpirySalesQueryService,
    private readonly exceptions: ExpiryPosExceptionsService,
  ) {}
  @Get('commerce-exceptions')
  @RequirePermission('inventory.costs.manage')
  @ApiOkResponse({ type: ExpiryExceptionsDto })
  exceptionsList(@CurrentUser() ctx: AuthContext, @Query() query: PageQueryDto) {
    return this.exceptions.list(ctx, query);
  }
  @Post('commerce-exceptions/:id/acknowledge')
  @RequirePermission('inventory.costs.manage', 'expiry.liability.manage', 'pricing.prices.manage')
  @Idempotent()
  @ApiCreatedResponse()
  acknowledge(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryExceptionAcknowledgementDto,
  ) {
    return this.exceptions.acknowledge(ctx, body.origin, id, body.note);
  }
  @Get('barcodes/:barcode')
  @Authenticated()
  @ApiOkResponse({ type: ExpirySaleOfferDto })
  barcode(@Param('barcode') barcode: string, @Query() query: ExpiryBarcodeQueryDto) {
    return this.commerce.barcodeForPipeline(barcode, query.pipelineId);
  }
  @Get('items/:id/commerce')
  @RequirePermission('inventory.costs.manage')
  @ApiOkResponse({ type: ExpiryCommerceDto })
  detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.commerce.detailFor(ctx, id);
  }
  @Get('items/:id/sales-history')
  @RequirePermission('inventory.costs.manage')
  @ApiOkResponse({ type: ExpirySalesPageDto })
  salesHistory(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PageQueryDto,
  ) {
    return this.sales.list(ctx, id, query);
  }
  @Get('items/:id/receipt-sources')
  @RequirePermission('inventory.costs.manage')
  @ApiOkResponse({ type: ExpiryReceiptSourcesDto })
  sources(@Param('id', ParseIntPipe) id: number) {
    return this.commerce.sources(id);
  }
  @Get('items/:id/prices')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryContextPricesDto })
  prices(@Param('id', ParseIntPipe) id: number) {
    return this.commerce.prices(id);
  }
  @Put('items/:id/source')
  @RequirePermission('inventory.costs.manage', 'expiry.items.manage')
  @ApiOkResponse({ type: ExpiryCommerceDto })
  source(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpirySourceRequestDto,
  ) {
    return this.commerce.setSource(ctx, id, body);
  }
  @Post('items/:id/markdowns')
  @RequirePermission('inventory.costs.manage', 'expiry.liability.manage', 'pricing.prices.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: ExpiryCommerceDto })
  publish(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryMarkdownRequestDto,
  ) {
    return this.commerce.publish(ctx, id, body);
  }
  @Post('markdowns/:id/stop')
  @RequirePermission('inventory.costs.manage', 'expiry.liability.manage', 'pricing.prices.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: ExpiryCommerceDto })
  stop(@CurrentUser() ctx: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.commerce.stop(ctx, id);
  }
  @Post('sale-exceptions/:id/resolve')
  @RequirePermission('inventory.costs.manage', 'expiry.liability.manage', 'pricing.prices.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: ExpiryCommerceDto })
  resolve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryExceptionResolutionDto,
  ) {
    return this.commerce.resolveException(ctx, id, body.note);
  }
}
