import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import { ProductRegistrationDto, RegisteredProductDto } from '../dto/product-registrations.dto';
import { ProductRegistrationService } from '../services/product-registration.service';

const REGISTER = 'catalog.products.register';

/** Registering a new product with its supplier, home warehouse and photos (ADR-0044 #5). */
@ApiTags('catalog')
@Controller('product-registrations')
export class ProductRegistrationsController {
  constructor(private readonly registrations: ProductRegistrationService) {}

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
