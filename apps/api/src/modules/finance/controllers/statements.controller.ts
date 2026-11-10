import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { STATEMENT_KINDS, type StatementKind } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { invalid } from '../../../common/errors/app-error';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { StatementDto, StatementLinkDto, StatementQueryDto } from '../dto/statements.dto';
import { type Statement, StatementsService } from '../services/statements.service';
import { money } from './mappers';

const SLUGS: Record<string, StatementKind> = { balance: 'BALANCE', income: 'INCOME' };

function kindOf(slug: string): StatementKind {
  const kind = SLUGS[slug];
  if (!kind) throw invalid('kind', 'isIn', `one of ${STATEMENT_KINDS.join(', ').toLowerCase()}`);
  return kind;
}

const dto = (statement: Statement): StatementDto => ({
  kind: statement.kind,
  from: statement.from,
  to: statement.to,
  rows: statement.rows.map((row) => ({
    code: row.code,
    no: row.no,
    type: row.type,
    level: row.level,
    opening: row.opening === null ? null : money(row.opening),
    amount: row.amount === null ? null : money(row.amount),
    accounts: row.accounts.map((account) => ({
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      kind: account.kind,
      opening: account.opening === null ? null : money(account.opening),
      amount: money(account.amount),
      linked: account.linked,
    })),
    result:
      row.result === null
        ? null
        : { opening: money(row.result.opening), amount: money(row.result.amount) },
  })),
  difference:
    statement.difference === null
      ? null
      : {
          opening: money(statement.difference.opening),
          amount: money(statement.difference.amount),
        },
});

/**
 * The statements СТ-1 (`balance`) and СТ-2 (`income`) on screen and in Excel (`finance.read`), and
 * the accountant's link of an account to a row (`finance.journal.manage`, as the chart) — ADR-0184.
 */
@ApiTags('finance')
@Controller('finance')
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get('reports/statements/:kind')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: StatementDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('kind') kind: string,
    @Query() query: StatementQueryDto,
  ): Promise<StatementDto> {
    return dto(await this.statements.get(ctx, { kind: kindOf(kind), ...query }));
  }

  @Get('reports/statements/:kind/xlsx')
  @RequirePermission('finance.read')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async xlsx(
    @CurrentUser() ctx: AuthContext,
    @Param('kind') slug: string,
    @Query() query: StatementQueryDto,
  ): Promise<StreamableFile> {
    const kind = kindOf(slug);
    return xlsxFile(
      await this.statements.workbook(ctx, { kind, ...query }),
      `statement-${slug}-${query.from}-${query.to}`,
      `${mn.finance.statements.kinds[kind]} ${query.from} – ${query.to}`,
    );
  }

  /** Puts an account on a row of its statement, or back on the default row. */
  @Put('statement-links/:accountId')
  @HttpCode(204)
  @RequirePermission('finance.journal.manage')
  async link(
    @CurrentUser() ctx: AuthContext,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() body: StatementLinkDto,
  ): Promise<void> {
    await this.statements.link(ctx, accountId, body.rowCode ?? null);
  }
}
