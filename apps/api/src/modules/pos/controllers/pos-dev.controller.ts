import { Body, Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  DevCloseShiftDto,
  DevOpenShiftDto,
  DevSaleDto,
  SaleDetailDto,
  ShiftDto,
} from '../dto/pos.dto';
import { PosDevService } from '../services/pos-dev.service';
import { PosQueryService } from '../services/pos-query.service';
import { saleDetailDto, shiftDto } from './mappers';

/**
 * The admin's «Туршилтын касс» (ADR-0063 #8): the centre plays a till so the owner can walk the
 * whole path before the store's edge exists. Refused in production (`POS_DEV_ONLY`).
 */
@ApiTags('pos-dev')
@Controller('pos/dev')
export class PosDevController {
  constructor(
    private readonly dev: PosDevService,
    private readonly query: PosQueryService,
  ) {}

  @Post('shifts/open')
  @RequirePermission('pos.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: ShiftDto })
  async openShift(
    @CurrentUser() ctx: AuthContext,
    @Body() body: DevOpenShiftDto,
  ): Promise<ShiftDto> {
    const id = await this.dev.openShift(ctx, {
      tillId: body.tillId,
      cashierUserId: body.cashierUserId,
      openingFloat: new Decimal(body.openingFloat),
    });
    return shiftDto(await this.query.getShift(id));
  }

  @Post('sales')
  @RequirePermission('pos.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: SaleDetailDto })
  async sell(@CurrentUser() ctx: AuthContext, @Body() body: DevSaleDto): Promise<SaleDetailDto> {
    const id = await this.dev.sell(ctx, {
      shiftId: body.shiftId,
      cashierUserId: body.cashierUserId,
      approvedByUserId: body.approvedByUserId ?? null,
      lines: body.lines.map((line) => ({
        productUnitId: line.productUnitId,
        qty: new Decimal(line.qty),
      })),
      tenders: body.tenders.map((tender) => ({
        kind: tender.kind,
        amount: new Decimal(tender.amount),
        tendered: tender.tendered ? new Decimal(tender.tendered) : null,
      })),
      receiptType: body.receiptType ?? 'B2C',
      customerTin: body.customerTin ?? null,
      customerName: body.customerName ?? null,
      note: body.note ?? null,
    });
    return saleDetailDto(await this.query.getSale(id));
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  @RequirePermission('pos.manage')
  @Idempotent()
  @ApiOkResponse({ type: ShiftDto })
  async closeShift(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DevCloseShiftDto,
  ): Promise<ShiftDto> {
    await this.dev.closeShift(ctx, id, {
      countedCash: new Decimal(body.countedCash),
      floatKept: new Decimal(body.floatKept),
      note: body.note ?? null,
    });
    return shiftDto(await this.query.getShift(id));
  }
}
