import { Controller, Get, Query, StreamableFile, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { invalid } from '../../../common/errors/app-error';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import {
  ReportGateInterceptor,
  UngatedReport,
} from '../../../common/reports/report-gate.interceptor';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  BookReportOptionsDto,
  ProductSalesDataDto,
  ProductSalesDataQueryDto,
  ProductSalesDocumentsDto,
  ProductSalesQueryDto,
  ProductSalesReportDto,
  StockBalanceLinesDto,
  StockBalanceLinesQueryDto,
  StockBalanceQueryDto,
  StockBalanceReportDto,
  StockDocumentLinesDto,
  StockDocumentLinesQueryDto,
  StockDocumentsQueryDto,
  StockDocumentsReportDto,
} from '../dto/book-reports.dto';
import { BookOptionsService } from '../services/book-options.service';
import {
  productSalesWorkbook,
  stockBalanceWorkbook,
  stockDocumentsWorkbook,
} from '../services/book-workbooks';
import { ProductSalesService } from '../services/product-sales.service';
import { StockBalanceService } from '../services/stock-balance.service';
import { StockDocumentsService } from '../services/stock-documents.service';

const T = mn.reports.books.titles;

/**
 * Erkhet's stock and sales reports on Bto's books (ADR-0133): «Бараа материалын үлдэгдлийн
 * тайлан», «Борлуулалт /Бараагаар/» and «Бараа материалын тайлан /баримтаар/», each with the rows
 * behind a row and an Excel copy, and the lists their prompts offer; `reports.view` (costs and
 * stock values only with `reports.margins.view`).
 */
@ApiTags('reports')
@Controller('reports')
@UseInterceptors(ReportGateInterceptor)
export class BookReportsController {
  constructor(
    private readonly options: BookOptionsService,
    private readonly balances: StockBalanceService,
    private readonly sales: ProductSalesService,
    private readonly documents: StockDocumentsService,
  ) {}

  @Get('book-options')
  @UngatedReport()
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: BookReportOptionsDto })
  async bookOptions(): Promise<BookReportOptionsDto> {
    return this.options.options();
  }

  @Get('stock-balance')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: StockBalanceReportDto })
  async stockBalance(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockBalanceQueryDto,
  ): Promise<StockBalanceReportDto> {
    return this.balances.report(ctx, { ...query, by: query.by ?? 'product' });
  }

  @Get('stock-balance.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async stockBalanceXlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockBalanceQueryDto,
  ): Promise<StreamableFile> {
    const report = await this.balances.report(ctx, { ...query, by: query.by ?? 'product' });
    return xlsxFile(
      await stockBalanceWorkbook(report),
      `stock-balance-${query.from}-${query.to}`,
      `${T.stockBalance} ${query.from} – ${query.to}`,
    );
  }

  @Get('stock-balance/lines')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: StockBalanceLinesDto })
  async stockBalanceLines(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockBalanceLinesQueryDto,
  ): Promise<StockBalanceLinesDto> {
    return this.balances.lines(ctx, query);
  }

  @Get('product-sales')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ProductSalesReportDto })
  async productSales(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ProductSalesQueryDto,
  ): Promise<ProductSalesReportDto> {
    return this.sales.report(ctx, query);
  }

  @Get('product-sales.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async productSalesXlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ProductSalesQueryDto,
  ): Promise<StreamableFile> {
    return xlsxFile(
      await productSalesWorkbook(await this.sales.report(ctx, query)),
      `product-sales-${query.from}-${query.to}`,
      `${T.productSales} ${query.from} – ${query.to}`,
    );
  }

  /** Every sales line of the period for the browser to work the conditions by itself (ADR-0135). */
  @Get('product-sales/data')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ProductSalesDataDto })
  async productSalesData(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ProductSalesDataQueryDto,
  ): Promise<ProductSalesDataDto> {
    return this.sales.data(ctx, query);
  }

  /** The documents behind one product (`productId` required). */
  @Get('product-sales/documents')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ProductSalesDocumentsDto })
  async productSalesDocuments(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ProductSalesQueryDto,
  ): Promise<ProductSalesDocumentsDto> {
    const productId = query.productId;
    if (productId === undefined) throw invalid('productId', 'required', 'a product id');
    return this.sales.documents(ctx, { ...query, productId });
  }

  @Get('stock-documents')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: StockDocumentsReportDto })
  async stockDocuments(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockDocumentsQueryDto,
  ): Promise<StockDocumentsReportDto> {
    return this.documents.report(ctx, query);
  }

  @Get('stock-documents.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async stockDocumentsXlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockDocumentsQueryDto,
  ): Promise<StreamableFile> {
    return xlsxFile(
      await stockDocumentsWorkbook(await this.documents.report(ctx, query)),
      `stock-documents-${query.from}-${query.to}`,
      `${T.stockDocuments} ${query.from} – ${query.to}`,
    );
  }

  @Get('stock-documents/lines')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: StockDocumentLinesDto })
  async stockDocumentLines(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockDocumentLinesQueryDto,
  ): Promise<StockDocumentLinesDto> {
    return { data: await this.documents.lines(ctx, query) };
  }
}
