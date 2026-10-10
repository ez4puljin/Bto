import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../identity';
import { BarcodeResolutionDto } from '../dto/products.dto';
import { ProductsService } from '../services/products.service';
import { toBarcodeDto, toProductSummaryDto } from './mappers';

@ApiTags('catalog')
@Controller('barcodes')
export class BarcodesController {
  constructor(private readonly products: ProductsService) {}

  /** Scan lookup: 404 unknown, 409 BARCODE_AMBIGUOUS, 422 BARCODE_INVALID (ADR-0029). */
  @Get(':code')
  @Authenticated()
  @ApiOkResponse({ type: BarcodeResolutionDto })
  async resolve(@Param('code') code: string): Promise<BarcodeResolutionDto> {
    const found = await this.products.resolveBarcode(code);
    return {
      product: toProductSummaryDto(found.product),
      unit: { ...found.unit, factorToBase: found.unit.factorToBase.toString() },
      barcode: toBarcodeDto(found.barcode),
    };
  }
}
