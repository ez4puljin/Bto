import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  EbarimtCancelResolveDto,
  EbarimtPrintableReceiptDto,
  EbarimtReceiptAttentionDto,
  EbarimtReceiptDetailDto,
  EbarimtReceiptDto,
  EbarimtReceiptListQueryDto,
  EbarimtReceiptPageDto,
  EbarimtReceiptResolveDto,
} from '../dto/ebarimt.dto';
import { EbarimtRelayService } from '../services/ebarimt-relay.service';
import {
  EbarimtReceiptsService,
  type ReceiptDetail,
  type ReceiptView,
} from '../services/ebarimt-receipts.service';

const READ = 'finance.read';
const MANAGE = 'finance.invoices.manage';

export const toReceiptDto = (view: ReceiptView): EbarimtReceiptDto => ({
  id: view.id,
  sourceSystem: view.sourceSystem,
  sourceDocType: view.sourceDocType,
  sourceDocId: view.sourceDocId,
  docNumber: view.docNumber,
  orderNumber: view.orderNumber,
  buyerName: view.buyerName,
  receiptType: view.receiptType,
  status: view.status,
  errorCode: view.errorCode,
  message: view.message,
  customerTin: view.customerTin,
  consumerNo: view.consumerNo,
  total: view.total.toFixed(2),
  vatTotal: view.vatTotal.toFixed(2),
  cityTaxTotal: view.cityTaxTotal.toFixed(2),
  attempt: view.attempt,
  claimedAt: view.claimedAt?.toISOString() ?? null,
  claimedNodeCode: view.claimedNodeCode,
  ddtd: view.ddtd,
  posapiDate: view.posapiDate,
  issuedAt: view.issuedAt?.toISOString() ?? null,
  cancelStatus: view.cancelStatus,
  cancelReason: view.cancelReason,
  cancelMessage: view.cancelMessage,
  cancelledAt: view.cancelledAt?.toISOString() ?? null,
  printable: view.printable,
  createdAt: view.createdAt.toISOString(),
});

const toDetailDto = (detail: ReceiptDetail): EbarimtReceiptDetailDto => ({
  ...toReceiptDto(detail),
  lines: detail.lines,
  payments: detail.payments,
  merchantTin: detail.merchantTin,
  merchantName: detail.merchantName,
});

/**
 * «Санхүү → e-Barimt баримт» (ADR-0185): the wholesale receipts with their state, the accountant's
 * decision on one PosAPI left unanswered, and the print. Preparing one again after an ERROR is the
 * source document's route (`POST /invoices/:id/ebarimt`): only its owner can rebuild the request.
 */
@ApiTags('ebarimt')
@Controller('ebarimt/receipts')
export class EbarimtReceiptsController {
  constructor(
    private readonly receipts: EbarimtReceiptsService,
    private readonly relay: EbarimtRelayService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtReceiptPageDto })
  async list(@Query() query: EbarimtReceiptListQueryDto): Promise<EbarimtReceiptPageDto> {
    const page = await this.receipts.list(query);
    return { data: page.data.map(toReceiptDto), nextCursor: page.nextCursor };
  }

  // Declared before the routes of one receipt, so `attention` is never read as an id.
  @Get('attention')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtReceiptAttentionDto })
  async attention(): Promise<EbarimtReceiptAttentionDto> {
    const seen = this.relay.lastSeen();
    return {
      ...(await this.receipts.attention()),
      relaySeenAt: seen?.at.toISOString() ?? null,
      relayNodeCode: seen?.nodeCode ?? null,
    };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtReceiptDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<EbarimtReceiptDetailDto> {
    return toDetailDto(await this.receipts.get(id));
  }

  /**
   * The receipt to print. A POST: the first call hands out the lottery and the QR data and forgets
   * them (ADR-0185 #6); every later one answers a copy. Never cached.
   */
  @Post(':id/print')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtPrintableReceiptDto })
  async print(@Param('id', ParseIntPipe) id: number): Promise<EbarimtPrintableReceiptDto> {
    const printable = await this.receipts.printable(id);
    return {
      receipt: toDetailDto(printable.receipt),
      secrets: printable.secrets,
      copy: printable.copy,
    };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: EbarimtReceiptDetailDto })
  async resolve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EbarimtReceiptResolveDto,
  ): Promise<EbarimtReceiptDetailDto> {
    return toDetailDto(await this.receipts.resolve(ctx, id, body));
  }

  @Post(':id/cancel-resolve')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: EbarimtReceiptDetailDto })
  async resolveCancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EbarimtCancelResolveDto,
  ): Promise<EbarimtReceiptDetailDto> {
    return toDetailDto(await this.receipts.resolveCancel(ctx, id, body.outcome));
  }
}
