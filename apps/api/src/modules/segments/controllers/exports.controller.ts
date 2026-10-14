import { Body, Controller, HttpCode, Post, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { invalid } from '../../../common/errors/app-error';
import { RequirePermission } from '../../identity';
import { ProductExportRequestDto } from '../dto/product-export.dto';
import { ProductExportService } from '../services/product-export.service';

/** Excel exports of the lists (ADR-0049 #6). */
@ApiTags('segments')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ProductExportService) {}

  /**
   * The ticked products, or every product the list's filters keep, with the visible columns:
   * 422 EXPORT_TOO_LARGE above 20,000 rows, 429 while two exports are running.
   */
  @Post('products')
  @RequirePermission('catalog.products.export')
  @HttpCode(200)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async products(@Body() body: ProductExportRequestDto): Promise<StreamableFile> {
    const { productIds, columns, ...filters } = body;
    if (productIds && Object.values(filters).some((value) => value !== undefined)) {
      throw invalid('productIds', 'alone', 'ticked products are exported without filters');
    }
    const buffer = await this.exports.workbook({
      ...(productIds ? { productIds } : {}),
      filters,
      columns,
    });
    const day = businessDate();
    return xlsxFile(buffer, `products-${day}`, `${mn.catalog.products.title} ${day}`);
  }
}
