import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  AgingDto,
  AgingItemsDto,
  AgingQueryDto,
  DashboardDto,
  DashboardQueryDto,
  ProfitQueryDto,
  ProfitReportDto,
  RefreshStateDto,
  SalesDocumentsDto,
  SalesFilterQueryDto,
  StockReportDto,
  StockReportQueryDto,
  SupplierEntriesDto,
  SupplierEntriesQueryDto,
  SupplierReportDto,
  SupplierReportQueryDto,
} from '../dto/reports.dto';
import { AgingService } from '../services/aging.service';
import { type Dashboard, DashboardService } from '../services/dashboard.service';
import { ProfitService } from '../services/profit.service';
import { type RefreshState, RefreshService } from '../services/refresh.service';
import {
  agingWorkbook,
  dashboardWorkbook,
  profitWorkbook,
  stockWorkbook,
  supplierWorkbook,
} from '../services/report-workbooks';
import { type StockReport, StockReportService } from '../services/stock-report.service';
import { SupplierReportService } from '../services/supplier-report.service';

const L = mn.reports.excel;
/** The Excel of the stock report holds at most this many products (500 a page). */
const STOCK_EXCEL_PAGES = 60;

function stateDto(state: RefreshState): RefreshStateDto {
  return { refreshedAt: state.refreshedAt?.toISOString() ?? null, durationMs: state.durationMs };
}

function dashboardDto(report: Dashboard): DashboardDto {
  return { ...report, refreshedAt: report.refreshedAt?.toISOString() ?? null };
}

/**
 * Management reports (ADR-0108, docs/modules/reporting.md): the dashboard, receivables aging,
 * profitability, stock turnover and the suppliers, each with an Excel twin. `reports.view` reads
 * them; costs, profit, margins and stock values need `reports.margins.view` (profitability
 * and the suppliers' purchase amounts altogether).
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly dashboards: DashboardService,
    private readonly agings: AgingService,
    private readonly profits: ProfitService,
    private readonly stocks: StockReportService,
    private readonly suppliers: SupplierReportService,
    private readonly refresher: RefreshService,
  ) {}

  @Get('refresh-state')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: RefreshStateDto })
  async refreshState(): Promise<RefreshStateDto> {
    return stateDto(await this.refresher.state());
  }

  /** «Шинэчлэх»: rebuilds the daily totals unless they are younger than a minute. */
  @Post('refresh')
  @HttpCode(200)
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: RefreshStateDto })
  async refresh(): Promise<RefreshStateDto> {
    return stateDto(await this.refresher.refreshByUser());
  }

  @Get('dashboard')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: DashboardDto })
  async dashboard(@CurrentUser() ctx: AuthContext, @Query() query: DashboardQueryDto): Promise<DashboardDto> {
    return dashboardDto(await this.dashboards.dashboard(ctx, query.month));
  }

  @Get('dashboard.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async dashboardXlsx(@CurrentUser() ctx: AuthContext, @Query() query: DashboardQueryDto): Promise<StreamableFile> {
    const report = await this.dashboards.dashboard(ctx, query.month);
    return xlsxFile(
      await dashboardWorkbook(report),
      `dashboard-${report.month}`,
      `${L.dashboard.title} ${report.month}`,
    );
  }

  @Get('aging')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: AgingDto })
  aging(@CurrentUser() ctx: AuthContext, @Query() query: AgingQueryDto): Promise<AgingDto> {
    return this.agings.aging(ctx, query);
  }

  @Get('aging.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async agingXlsx(@CurrentUser() ctx: AuthContext, @Query() query: AgingQueryDto): Promise<StreamableFile> {
    const report = await this.agings.aging(ctx, query);
    return xlsxFile(await agingWorkbook(report), `aging-${report.date}`, `${L.aging.title} ${report.date}`);
  }

  @Get('aging/:partyId/items')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: AgingItemsDto })
  async agingItems(
    @CurrentUser() ctx: AuthContext,
    @Param('partyId', ParseIntPipe) partyId: number,
  ): Promise<AgingItemsDto> {
    return { data: await this.agings.items(ctx, partyId) };
  }

  @Get('profit')
  @RequirePermission('reports.margins.view')
  @ApiOkResponse({ type: ProfitReportDto })
  profit(@CurrentUser() ctx: AuthContext, @Query() query: ProfitQueryDto): Promise<ProfitReportDto> {
    const { by, ...filter } = query;
    return this.profits.profit(ctx, by, filter);
  }

  @Get('profit.xlsx')
  @RequirePermission('reports.margins.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async profitXlsx(@CurrentUser() ctx: AuthContext, @Query() query: ProfitQueryDto): Promise<StreamableFile> {
    const { by, ...filter } = query;
    const report = await this.profits.profit(ctx, by, filter);
    return xlsxFile(
      await profitWorkbook(report),
      `profit-${by}-${report.from}-${report.to}`,
      `${L.profit.title} ${report.from} – ${report.to}`,
    );
  }

  /** The documents behind a sales figure (the drill-down); costs only with margins. */
  @Get('sales-documents')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: SalesDocumentsDto })
  salesDocuments(@CurrentUser() ctx: AuthContext, @Query() query: SalesFilterQueryDto): Promise<SalesDocumentsDto> {
    return this.profits.documents(ctx, query);
  }

  @Get('stock')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: StockReportDto })
  stock(@CurrentUser() ctx: AuthContext, @Query() query: StockReportQueryDto): Promise<StockReportDto> {
    return this.stocks.stock(ctx, query);
  }

  @Get('stock.xlsx')
  @RequirePermission('reports.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async stockXlsx(@CurrentUser() ctx: AuthContext, @Query() query: StockReportQueryDto): Promise<StreamableFile> {
    let page: StockReport = await this.stocks.stock(ctx, { ...query, offset: 0, limit: 500 });
    const all: StockReport = { ...page, rows: [...page.rows] };
    for (let n = 1; n < STOCK_EXCEL_PAGES && page.nextOffset !== null; n += 1) {
      page = await this.stocks.stock(ctx, { ...query, offset: page.nextOffset, limit: 500 });
      all.rows.push(...page.rows);
    }
    return xlsxFile(
      await stockWorkbook(all, ctx.permissions.has('reports.margins.view')),
      `stock-${all.date}`,
      `${L.stock.title} ${all.date}`,
    );
  }

  @Get('suppliers')
  @RequirePermission('reports.margins.view')
  @ApiOkResponse({ type: SupplierReportDto })
  supplierReport(@CurrentUser() ctx: AuthContext, @Query() query: SupplierReportQueryDto): Promise<SupplierReportDto> {
    return this.suppliers.suppliers(ctx, query);
  }

  @Get('suppliers.xlsx')
  @RequirePermission('reports.margins.view')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async supplierXlsx(@CurrentUser() ctx: AuthContext, @Query() query: SupplierReportQueryDto): Promise<StreamableFile> {
    const report = await this.suppliers.suppliers(ctx, query);
    return xlsxFile(
      await supplierWorkbook(report),
      `suppliers-${report.from}-${report.to}`,
      `${L.suppliers.title} ${report.from} – ${report.to}`,
    );
  }

  @Get('suppliers/:partyId/entries')
  @RequirePermission('reports.margins.view')
  @ApiOkResponse({ type: SupplierEntriesDto })
  async supplierEntries(
    @CurrentUser() ctx: AuthContext,
    @Param('partyId', ParseIntPipe) partyId: number,
    @Query() query: SupplierEntriesQueryDto,
  ): Promise<SupplierEntriesDto> {
    return { data: await this.suppliers.entries(ctx, partyId, query) };
  }
}
