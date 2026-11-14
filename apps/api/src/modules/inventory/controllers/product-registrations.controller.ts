import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  ProductAiPictureDto,
  ProductAiPictureResultDto,
  ProductAiProposalDto,
  ProductAiReadDto,
  ProductAiStatusDto,
} from '../dto/product-ai.dto';
import { ProductRegistrationDto, RegisteredProductDto } from '../dto/product-registrations.dto';
import { ProductAiFlowService } from '../services/product-ai-flow.service';
import { ProductRegistrationService } from '../services/product-registration.service';

const REGISTER = 'catalog.products.register';

/** Registering a new product with its supplier, home warehouse and photos (ADR-0044 #5). */
@ApiTags('catalog')
@Controller('product-registrations')
export class ProductRegistrationsController {
  constructor(
    private readonly registrations: ProductRegistrationService,
    private readonly ai: ProductAiFlowService,
  ) {}

  /** What «AI ашиглах» can do now (ADR-0198): the form explains what is not set. */
  @Get('ai')
  @RequirePermission(REGISTER)
  @ApiOkResponse({ type: ProductAiStatusDto })
  aiStatus(): Promise<ProductAiStatusDto> {
    return this.ai.status();
  }

  /**
   * Reads photos of one product and proposes the form's values (ADR-0198); saves nothing. 503
   * while no model is set, 502 when the provider fails: the form is then filled by hand.
   */
  @Post('ai/read')
  @HttpCode(200)
  @RequirePermission(REGISTER)
  @ApiOkResponse({ type: ProductAiProposalDto })
  aiRead(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ProductAiReadDto,
  ): Promise<ProductAiProposalDto> {
    return this.ai.read(ctx, body.photoFileIds);
  }

  /** Cuts the product of a photo out of its background, with the company's logo to draw on it. */
  @Post('ai/picture')
  @HttpCode(200)
  @RequirePermission(REGISTER)
  @ApiOkResponse({ type: ProductAiPictureResultDto })
  aiPicture(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ProductAiPictureDto,
  ): Promise<ProductAiPictureResultDto> {
    return this.ai.picture(ctx, body.photoFileId);
  }

  @Post()
  @RequirePermission(REGISTER)
  @Idempotent()
  @ApiCreatedResponse({ type: RegisteredProductDto })
  async register(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ProductRegistrationDto,
  ): Promise<RegisteredProductDto> {
    const product = await this.registrations.register(ctx, {
      sku: body.sku,
      name: body.name,
      categoryId: body.categoryId,
      baseUomId: body.baseUomId,
      weightKg: body.weightKg ? new Decimal(body.weightKg) : null,
      baseBarcodes: body.baseBarcodes ?? [],
      boxFactor: new Decimal(body.boxFactor),
      boxBarcodes: body.boxBarcodes ?? [],
      units: (body.units ?? []).map((unit) => ({
        uomId: unit.uomId,
        factorToBase: new Decimal(unit.factorToBase),
        barcodes: unit.barcodes ?? [],
      })),
      supplierId: body.supplierId,
      homeWarehouseId: body.homeWarehouseId,
      fixedBinCode: body.fixedBinCode ?? null,
      images: body.images,
    });
    return { productId: product.id, sku: product.sku, name: product.name };
  }
}
