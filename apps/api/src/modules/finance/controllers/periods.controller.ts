import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FinPeriodEventView, FinPeriodView } from '../../../finance-core';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  FinancePeriodDto,
  FinancePeriodEventListDto,
  FinancePeriodEventQueryDto,
  FinancePeriodListDto,
  FinancePeriodReopenRequestDto,
  type FinancePeriodEventDto,
} from '../dto/finance.dto';
import { PeriodsService } from '../services/periods.service';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function period(code: string): string {
  if (!PERIOD.test(code)) throw invalid('code', 'period', 'a month as YYYY-MM');
  return code;
}

function eventDto(event: FinPeriodEventView): FinancePeriodEventDto {
  return {
    id: event.id,
    period: event.period,
    action: event.action,
    reason: event.reason,
    actorLabel: event.actorLabel,
    createdAt: event.createdAt.toISOString(),
  };
}

function periodDto(row: FinPeriodView): FinancePeriodDto {
  return {
    id: row.id,
    code: row.code,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    lastEvent: row.lastEvent ? eventDto(row.lastEvent) : null,
  };
}

/**
 * «Сарын хаалт» (ADR-0102): the company's months, closing a month that has ended (the earlier ones
 * closed, the reconcile clean) and reopening the latest closed one with a reason.
 */
@ApiTags('finance')
@Controller('finance/periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: FinancePeriodListDto })
  async list(@CurrentUser() ctx: AuthContext): Promise<FinancePeriodListDto> {
    return { data: (await this.periods.list(ctx)).map(periodDto) };
  }

  @Get('events')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: FinancePeriodEventListDto })
  async events(
    @CurrentUser() ctx: AuthContext,
    @Query() query: FinancePeriodEventQueryDto,
  ): Promise<FinancePeriodEventListDto> {
    return { data: (await this.periods.events(ctx, query.period)).map(eventDto) };
  }

  @Post(':code/close')
  @HttpCode(200)
  @RequirePermission('finance.periods.close')
  @Idempotent()
  @ApiOkResponse({ type: FinancePeriodDto })
  async close(
    @CurrentUser() ctx: AuthContext,
    @Param('code') code: string,
  ): Promise<FinancePeriodDto> {
    return periodDto(await this.periods.close(ctx, period(code)));
  }

  @Post(':code/reopen')
  @HttpCode(200)
  @RequirePermission('finance.periods.reopen')
  @Idempotent()
  @ApiOkResponse({ type: FinancePeriodDto })
  async reopen(
    @CurrentUser() ctx: AuthContext,
    @Param('code') code: string,
    @Body() body: FinancePeriodReopenRequestDto,
  ): Promise<FinancePeriodDto> {
    return periodDto(await this.periods.reopen(ctx, period(code), body.reason));
  }
}
