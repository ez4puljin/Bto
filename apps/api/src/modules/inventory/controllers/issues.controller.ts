import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CheckIssueLineDto,
  CreateIssueDto,
  CreateIssueExpenseTypeDto,
  IssueDetailDto,
  IssueExpenseTypeDto,
  IssueLineRequestDto,
  IssueListQueryDto,
  IssuePageDto,
  ReturnIssueDto,
  SetIssueLineBinDto,
  UpdateIssueDto,
  UpdateIssueExpenseTypeDto,
  UpdateIssueLineDto,
} from '../dto/issues.dto';
import { GoodsIssuesService, type IssueDetail } from '../services/goods-issues.service';
import { IssueExpenseTypesService } from '../services/issue-expense-types.service';

const MANAGE = 'inventory.issues.manage';
const CONFIRM = 'inventory.issues.confirm';
const SETUP = 'inventory.setup.manage';
const COSTS = 'inventory.costs.manage';

const lineInput = (line: IssueLineRequestDto) => ({
  productUnitId: line.productUnitId,
  enteredQty: new Decimal(line.enteredQty),
  ...(line.warehouseId === undefined ? {} : { warehouseId: line.warehouseId }),
  ...(line.binId === undefined ? {} : { binId: line.binId }),
});

/** Costs only for holders of inventory.costs.manage (ADR-0033 #8); sale prices for everyone. */
function toIssueDto(issue: IssueDetail, withCosts: boolean): IssueDetailDto {
  return {
    ...issue,
    sentAt: issue.sentAt?.toISOString() ?? null,
    returnedAt: issue.returnedAt?.toISOString() ?? null,
    postedAt: issue.postedAt?.toISOString() ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    lines: issue.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      enteredQty: line.enteredQty.toFixed(),
      factorSnapshot: line.factorSnapshot.toFixed(),
      qtyBase: line.qtyBase.toFixed(),
      warehouseId: line.warehouseId,
      warehouseName: line.warehouseName,
      binId: line.binId,
      binCode: line.binCode,
      checkedAt: line.checkedAt?.toISOString() ?? null,
      saleUnitPrice: line.saleUnitPrice?.toFixed(0) ?? null,
      saleAmount: line.saleAmount?.toFixed(0) ?? null,
      ...(withCosts
        ? {
            unitCost: line.unitCost?.toFixed() ?? null,
            amount: line.amount?.toFixed(2) ?? null,
          }
        : {}),
    })),
    confirmations: issue.confirmations.map((row) => ({
      ...row,
      confirmedAt: row.confirmedAt.toISOString(),
    })),
    saleTotal: issue.saleTotal?.toFixed(0) ?? null,
    total: undefined,
    ...(withCosts ? { total: issue.total?.toFixed(2) ?? null } : {}),
  };
}

const detail = (ctx: AuthContext) => (issue: IssueDetail) =>
  toIssueDto(issue, ctx.permissions.has(COSTS));

/**
 * Goods issues (ADR-0081, ADR-0117): the accountant creates and sends them, each warehouse's
 * keeper confirms their part; every user reads them without costs. The expense types are read by
 * everyone and kept by the admin.
 */
@ApiTags('inventory')
@Controller('issues')
export class IssuesController {
  constructor(
    private readonly issues: GoodsIssuesService,
    private readonly types: IssueExpenseTypesService,
  ) {}

  @Get('expense-types')
  @Authenticated()
  @ApiOkResponse({ type: [IssueExpenseTypeDto] })
  expenseTypes(): Promise<IssueExpenseTypeDto[]> {
    return this.types.list();
  }

  @Post('expense-types')
  @RequirePermission(SETUP)
  @ApiCreatedResponse({ type: IssueExpenseTypeDto })
  createExpenseType(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateIssueExpenseTypeDto,
  ): Promise<IssueExpenseTypeDto> {
    return this.types.create(ctx, body);
  }

  @Patch('expense-types/:id')
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: IssueExpenseTypeDto })
  updateExpenseType(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateIssueExpenseTypeDto,
  ): Promise<IssueExpenseTypeDto> {
    return this.types.update(ctx, id, body);
  }

  /** `pending=1`: the sent issues with a line of the caller's warehouses still to confirm. */
  @Get()
  @Authenticated()
  @ApiOkResponse({ type: IssuePageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: IssueListQueryDto,
  ): Promise<IssuePageDto> {
    const { pending, ...rest } = query;
    const page = await this.issues.list({
      ...rest,
      ...(pending
        ? {
            pendingIn:
              ctx.writableWarehouseIds === null ? null : [...ctx.writableWarehouseIds.values()],
          }
        : {}),
    });
    return {
      data: page.data.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: IssueDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: IssueDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateIssueDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(
      await this.issues.create(ctx, {
        warehouseId: body.warehouseId,
        issuedOn: body.issuedOn ?? null,
        expenseTypeId: body.expenseTypeId,
        recipient: body.recipient,
        note: body.note ?? null,
        lines: (body.lines ?? []).map(lineInput),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: IssueDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateIssueDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.update(ctx, id, body));
  }

  @Post(':id/lines')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: IssueDetailDto })
  async addLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: IssueLineRequestDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.addLine(ctx, id, lineInput(body)));
  }

  /** DRAFT / RETURNED → SENT: the keepers may confirm (ADR-0117 #1). */
  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: IssueDetailDto })
  async send(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.send(ctx, id));
  }

  /**
   * The keeper's confirmation of the warehouses in their scope: those parts leave at once
   * (ADR-0117 #2); idempotent so a retried click never posts twice.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission(CONFIRM)
  @Idempotent()
  @ApiOkResponse({ type: IssueDetailDto })
  async confirm(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.confirm(ctx, id));
  }

  /** The keeper sends the issue back to the accountant with a note. */
  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission(CONFIRM)
  @ApiOkResponse({ type: IssueDetailDto })
  async return(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReturnIssueDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.return(ctx, id, body.note));
  }

  /** A correction of a posted issue: a child draft with the parent's lines (ADR-0117 #5). */
  @Post(':id/corrections')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: IssueDetailDto })
  async createCorrection(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.createCorrection(ctx, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: IssueDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.cancel(ctx, id));
  }
}

@ApiTags('inventory')
@Controller('issue-lines')
export class IssueLinesController {
  constructor(private readonly issues: GoodsIssuesService) {}

  /** The accountant's edit: the quantity or the warehouse of an unconfirmed line. */
  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: IssueDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateIssueLineDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(
      await this.issues.updateLine(ctx, id, {
        ...(body.enteredQty === undefined ? {} : { enteredQty: new Decimal(body.enteredQty) }),
        ...(body.warehouseId === undefined ? {} : { warehouseId: body.warehouseId }),
      }),
    );
  }

  /** The keeper's tick on a line of their warehouse (ADR-0117 #1). */
  @Patch(':id/check')
  @RequirePermission(CONFIRM)
  @ApiOkResponse({ type: IssueDetailDto })
  async check(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CheckIssueLineDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.checkLine(ctx, id, body.checked));
  }

  /** The keeper names the shelf a line leaves from (a scanned label). */
  @Patch(':id/bin')
  @RequirePermission(CONFIRM)
  @ApiOkResponse({ type: IssueDetailDto })
  async setBin(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetIssueLineBinDto,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.setLineBin(ctx, id, body.binId));
  }

  @Delete(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: IssueDetailDto })
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.removeLine(ctx, id));
  }
}
