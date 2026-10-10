import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import { AttachImageDto, ProductImageDto } from '../dto/products.dto';
import {
  AssignRequestDto,
  AssignResultDto,
  ReadinessPageDto,
  ReadinessQueryDto,
  ReadinessReportDto,
} from '../dto/readiness.dto';
import { EbarimtReadinessService } from '../services/ebarimt-readiness.service';
import { ProductImagesService } from '../services/product-images.service';
import { toProductSummaryDto } from './mappers';

const EBARIMT = 'catalog.ebarimt.manage';
const MANAGE = 'catalog.products.manage';

/** e-Barimt readiness (SPEC §5.2, ADR-0015 #3). */
@ApiTags('catalog')
@Controller('catalog/ebarimt-readiness')
export class ReadinessController {
  constructor(private readonly readiness: EbarimtReadinessService) {}

  @Get()
  @RequirePermission(EBARIMT)
  @ApiOkResponse({ type: ReadinessReportDto })
  report(): Promise<ReadinessReportDto> {
    return this.readiness.report();
  }

  @Get('products')
  @RequirePermission(EBARIMT)
  @ApiOkResponse({ type: ReadinessPageDto })
  async products(@Query() query: ReadinessQueryDto): Promise<ReadinessPageDto> {
    const page = await this.readiness.list(query);
    return {
      data: page.data.map((row) => ({
        product: toProductSummaryDto(row.product),
        missing: row.missing,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Fills empty attributes of a category subtree; `dryRun` counts first. */
  @Post('assign')
  @HttpCode(200)
  @RequirePermission(EBARIMT)
  @Idempotent()
  @ApiOkResponse({ type: AssignResultDto })
  assign(
    @CurrentUser() ctx: AuthContext,
    @Body() body: AssignRequestDto,
  ): Promise<AssignResultDto> {
    return this.readiness.assign(ctx, body);
  }
}

/** Product photos (ADR-0030). */
@ApiTags('catalog')
@Controller()
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post('products/:id/images')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ProductImageDto })
  attach(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AttachImageDto,
  ): Promise<ProductImageDto> {
    return this.images.attach(ctx, id, body);
  }

  @Post('product-images/:id/primary')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ProductImageDto })
  primary(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductImageDto> {
    return this.images.setPrimary(ctx, id);
  }

  @Delete('product-images/:id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.images.remove(ctx, id);
  }
}
