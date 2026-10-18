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
  CreateIssueDto,
  CreateIssueExpenseTypeDto,
  IssueDetailDto,
  IssueExpenseTypeDto,
  IssueLineRequestDto,
  IssueListQueryDto,
  IssuePageDto,
  UpdateIssueDto,
  UpdateIssueExpenseTypeDto,
  UpdateIssueLineDto,
} from '../dto/issues.dto';
import { GoodsIssuesService, type IssueDetail } from '../services/goods-issues.service';
import { IssueExpenseTypesService } from '../services/issue-expense-types.service';

const MANAGE = 'inventory.issues.manage';
const SETUP = 'inventory.setup.manage';
const COSTS = 'inventory.costs.manage';

const lineInput = (line: IssueLineRequestDto) => ({
  productUnitId: line.productUnitId,
  enteredQty: new Decimal(line.enteredQty),
  ...(line.binId === undefined ? {} : { binId: line.binId }),
});

/** Costs only for holders of inventory.costs.manage (ADR-0033 #8). */
function toIssueDto(issue: IssueDetail, withCosts: boolean): IssueDetailDto {
  return {
    ...issue,
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
      binId: line.binId,
      binCode: line.binCode,
      ...(withCosts
        ? {
            unitCost: line.unitCost?.toFixed() ?? null,
            amount: line.amount?.toFixed(2) ?? null,
          }
        : {}),
    })),
    total: undefined,
    ...(withCosts ? { total: issue.total?.toFixed(2) ?? null } : {}),
  };
}

const detail = (ctx: AuthContext) => (issue: IssueDetail) =>
  toIssueDto(issue, ctx.permissions.has(COSTS));

/**
 * Goods issues (ADR-0081): warehouse staff create and post them; every user reads them without
 * costs. The expense types are read by everyone and kept by the admin.
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

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: IssuePageDto })
  async list(@Query() query: IssueListQueryDto): Promise<IssuePageDto> {
    const page = await this.issues.list(query);
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

  /** DRAFT → POSTED by the warehouse itself; idempotent so a retried click never posts twice. */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: IssueDetailDto })
  async post(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IssueDetailDto> {
    return detail(ctx)(await this.issues.post(ctx, id));
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
        ...(body.binId === undefined ? {} : { binId: body.binId }),
      }),
    );
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
