import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  CurrentUser,
  IdempotencyKey,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  AllocationDto,
  AllocationRequestDto,
  AllocationReversalDto,
  OpenItemListDto,
  VoidRequestDto,
} from '../dto/finance.dto';
import { AllocationsService } from '../services/allocations.service';
import { money } from './mappers';

const READ = 'finance.read';
const PAYMENTS = 'finance.payments.record';

/**
 * The accountant's manual allocation (ADR-0072 #7, ADR-0090; docs/modules/finance-core.md §11): a
 * customer's open items, an allocation of a credit item to debit items, and its reversal.
 */
@ApiTags('finance')
@Controller()
export class AllocationsController {
  constructor(private readonly allocations: AllocationsService) {}

  @Get('customer-balances/:customerId/open-items')
  @RequirePermission(READ)
  @ApiOkResponse({ type: OpenItemListDto })
  async openItems(@Param('customerId', ParseIntPipe) customerId: number): Promise<OpenItemListDto> {
    const items = await this.allocations.openItems(customerId);
    return {
      data: items.map((item) => ({
        ...item,
        amount: money(item.amount),
        openAmount: money(item.openAmount),
      })),
    };
  }

  @Post('finance/allocations')
  @RequirePermission(PAYMENTS)
  @Idempotent()
  @ApiCreatedResponse({ type: AllocationDto })
  async allocate(
    @CurrentUser() ctx: AuthContext,
    @Body() body: AllocationRequestDto,
    @IdempotencyKey() key?: string,
  ): Promise<AllocationDto> {
    const result = await this.allocations.allocate(ctx, {
      customerId: body.customerId,
      date: body.date ?? null,
      description: body.description ?? null,
      pairs: body.pairs.map((pair) => ({
        debitItemId: pair.debitItemId,
        creditItemId: pair.creditItemId,
        amount: new Decimal(pair.amount),
      })),
      key: key ?? null,
    });
    return {
      ...result,
      amount: money(result.amount),
      pairs: result.pairs.map((pair) => ({ ...pair, amount: money(pair.amount) })),
    };
  }

  @Post('finance/allocations/:id/reverse')
  @HttpCode(200)
  @RequirePermission(PAYMENTS)
  @Idempotent()
  @ApiOkResponse({ type: AllocationReversalDto })
  async reverse(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VoidRequestDto,
  ): Promise<AllocationReversalDto> {
    return this.allocations.reverse(ctx, id, body.reason);
  }
}
