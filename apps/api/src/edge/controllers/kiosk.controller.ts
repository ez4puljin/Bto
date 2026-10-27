import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeBarcodeHit,
  EdgeDeviceInfo,
  EdgeEbarimtQueue,
  EdgeHealth,
  EdgeLoginResponse,
  EdgeCartLine,
  EdgeCustomer,
  EdgePairResponse,
  EdgeParkedBasket,
  EdgePrintableReceipt,
  EdgeProductHit,
  EdgeQuickGroup,
  EdgeQuoteResponse,
  EdgeReceipt,
  EdgeReturnSale,
  EdgeSession,
  EdgeShiftSummary,
  EdgeSupervisor,
  EdgeTaxpayer,
  EdgeVoidResponse,
  PosapiInfoWire,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeState } from '../db/schema';
import {
  DiscardParkedDto,
  EbarimtResolveDto,
  EbarimtSendDataDto,
  LoginDto,
  PairDto,
  ParkDto,
  QuoteDto,
  ReturnDto,
  ReturnSaleQueryDto,
  SaleDto,
  SearchQueryDto,
  ShiftCloseDto,
  ShiftOpenDto,
  TaxpayerQueryDto,
  VoidDto,
} from '../dto/kiosk.dto';
import { EbarimtService } from '../ebarimt/ebarimt.service';
import { TaxpayerClient } from '../ebarimt/taxpayer.client';
import {
  cashierOf,
  DeviceOnly,
  EdgePublic,
  Kiosk,
  type KioskContext,
  KioskGuard,
} from '../guards/kiosk.guard';
import { CheckoutService } from '../services/checkout.service';
import { CustomerStore } from '../services/customer.store';
import { DevicesService } from '../services/devices.service';
import { KioskAuthService } from '../services/kiosk-auth.service';
import { OutboxService } from '../services/outbox.service';
import { EdgeParkedService } from '../services/parked.service';
import { EdgeReturnsService } from '../services/returns.service';
import { EdgeShiftsService } from '../services/shifts.service';
import { SnapshotStore } from '../services/snapshot.store';
import { EdgeVoidsService } from '../services/voids.service';

/** The centre counts as reachable when the last call to it worked within this long. */
const REACHABLE_MS = 120_000;

/**
 * What the till's browser calls (ADR-0067; the shapes are in @tugeel/shared/pos): health and
 * pairing without a device, the cashier list and the PIN with a device, everything else with a
 * cashier's session too.
 */
@Controller()
@UseGuards(KioskGuard)
export class KioskController {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly config: EdgeConfig,
    private readonly store: SnapshotStore,
    private readonly outbox: OutboxService,
    private readonly devices: DevicesService,
    private readonly auth: KioskAuthService,
    private readonly shifts: EdgeShiftsService,
    private readonly checkout: CheckoutService,
    private readonly voids: EdgeVoidsService,
    private readonly parked: EdgeParkedService,
    private readonly returns: EdgeReturnsService,
    private readonly ebarimt: EbarimtService,
    private readonly taxpayers: TaxpayerClient,
    private readonly customers: CustomerStore,
  ) {}

  @Get('health')
  @EdgePublic()
  async health(): Promise<EdgeHealth> {
    const [state] = await this.db.select().from(edgeState).where(eq(edgeState.id, 1));
    const loaded = this.store.peek();
    const contact = state?.lastContactAt?.getTime() ?? 0;
    return {
      status: 'ok',
      version: this.config.get('APP_VERSION'),
      node: loaded ? { code: loaded.snapshot.node.code, name: loaded.snapshot.node.name } : null,
      snapshot: {
        version: loaded?.snapshot.version ?? null,
        pulledAt: this.store.lastPulledAt()?.toISOString() ?? null,
        products: loaded?.snapshot.products.length ?? 0,
      },
      central: {
        reachable: !state?.lastError && Date.now() - contact < REACHABLE_MS,
        lastPullAt: state?.pulledAt?.toISOString() ?? null,
        lastPushAt: state?.lastPushAt?.toISOString() ?? null,
      },
      outbox: await this.outbox.counts(),
      ebarimt: await this.ebarimt.summary(),
    };
  }

  @Post('pair')
  @HttpCode(200)
  @EdgePublic()
  async pair(
    @Body() body: PairDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<EdgePairResponse> {
    const { token, till } = await this.devices.pair(
      body.tillCode,
      body.pairingCode,
      userAgent ?? null,
    );
    return { deviceToken: token, till };
  }

  @Get('device')
  @DeviceOnly()
  device(@Kiosk() kiosk: KioskContext): EdgeDeviceInfo {
    const loaded = this.store.get();
    const till = loaded.tills.get(kiosk.device.tillCode);
    return {
      till: { code: kiosk.device.tillCode, name: till?.name ?? kiosk.device.tillCode },
      cashiers: this.auth.cashiers(),
      companyName: loaded.snapshot.company.name,
    };
  }

  @Post('auth/pin')
  @HttpCode(200)
  @DeviceOnly()
  login(@Kiosk() kiosk: KioskContext, @Body() body: LoginDto): Promise<EdgeLoginResponse> {
    return this.auth.login(kiosk.device, body.userId, body.pin);
  }

  /** Sessions are signed, not stored: the kiosk forgets its token; this only says it is gone. */
  @Post('auth/logout')
  @HttpCode(204)
  logout(): void {
    return undefined;
  }

  @Get('session')
  async session(@Kiosk() kiosk: KioskContext): Promise<EdgeSession> {
    const loaded = this.store.get();
    const shift = await this.shifts.current(kiosk.device.tillCode);
    return {
      till: {
        code: kiosk.device.tillCode,
        name: loaded.tills.get(kiosk.device.tillCode)?.name ?? kiosk.device.tillCode,
      },
      cashier: cashierOf(kiosk),
      shift: shift ? await this.shifts.summary(shift) : null,
      businessDate: businessDate(),
      companyName: loaded.snapshot.company.name,
      approvalRequired: loaded.snapshot.settings.supervisorRequired,
    };
  }

  @Post('shifts/open')
  @HttpCode(200)
  openShift(@Kiosk() kiosk: KioskContext, @Body() body: ShiftOpenDto): Promise<EdgeShiftSummary> {
    return this.shifts.open(
      kiosk.device.tillCode,
      cashierOf(kiosk),
      new Decimal(body.openingFloat),
    );
  }

  @Post('shifts/close')
  @HttpCode(200)
  closeShift(@Kiosk() kiosk: KioskContext, @Body() body: ShiftCloseDto): Promise<EdgeShiftSummary> {
    return this.shifts.close(kiosk.device.tillCode, {
      countedCash: new Decimal(body.countedCash),
      floatKept: new Decimal(body.floatKept),
      note: body.note?.trim() || null,
    });
  }

  @Get('products/search')
  search(@Query() query: SearchQueryDto): EdgeProductHit[] {
    return this.checkout.search(query.q);
  }

  @Get('products/barcode/:code')
  barcode(@Param('code') code: string): EdgeBarcodeHit {
    return this.checkout.barcode(code);
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body() body: QuoteDto): EdgeQuoteResponse {
    return this.checkout.quote(body.lines);
  }

  @Post('sales')
  @HttpCode(200)
  async sell(@Kiosk() kiosk: KioskContext, @Body() body: SaleDto): Promise<EdgePrintableReceipt> {
    const receipt = await this.checkout.sell(kiosk.device.tillCode, cashierOf(kiosk), body);
    return this.ebarimt.afterCommit(kiosk.device.tillCode, receipt.clientId);
  }

  /** ADR-0109: the customers a sale on credit may charge, from the feed (offline too). */
  @Get('customers')
  findCustomers(@Query() query: SearchQueryDto): Promise<EdgeCustomer[]> {
    return this.customers.find(query.q);
  }

  @Get('customers/:id')
  customer(@Param('id', ParseIntPipe) id: number): Promise<EdgeCustomer> {
    return this.customers.one(id);
  }

  @Get('sales/recent')
  recent(@Kiosk() kiosk: KioskContext): Promise<EdgeReceipt[]> {
    return this.checkout.recent(kiosk.device.tillCode);
  }

  // ADR-0104: quick buttons, approvals, voids, parked baskets and returns.

  @Get('quick-buttons')
  quickButtons(): EdgeQuickGroup[] {
    return this.checkout.quickGroups();
  }

  @Get('supervisors')
  supervisors(): EdgeSupervisor[] {
    return this.auth.supervisors();
  }

  @Post('voids')
  @HttpCode(200)
  void(@Kiosk() kiosk: KioskContext, @Body() body: VoidDto): Promise<EdgeVoidResponse> {
    return this.voids.record(kiosk.device.tillCode, cashierOf(kiosk), body);
  }

  @Get('parked')
  parkedList(@Kiosk() kiosk: KioskContext): Promise<EdgeParkedBasket[]> {
    return this.parked.list(kiosk.device.tillCode);
  }

  @Post('parked')
  @HttpCode(200)
  park(@Kiosk() kiosk: KioskContext, @Body() body: ParkDto): Promise<EdgeParkedBasket> {
    return this.parked.park(kiosk.device.tillCode, cashierOf(kiosk), body);
  }

  @Post('parked/:clientId/resume')
  @HttpCode(200)
  resume(
    @Kiosk() kiosk: KioskContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<EdgeCartLine[]> {
    return this.parked.resume(kiosk.device.tillCode, clientId);
  }

  @Post('parked/:clientId/discard')
  @HttpCode(204)
  discard(
    @Kiosk() kiosk: KioskContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: DiscardParkedDto,
  ): Promise<void> {
    return this.parked.discard(kiosk.device.tillCode, cashierOf(kiosk), clientId, body.approval);
  }

  @Get('returns/sale')
  returnSale(@Query() query: ReturnSaleQueryDto): Promise<EdgeReturnSale> {
    return this.returns.findSale(query.number);
  }

  @Post('returns')
  @HttpCode(200)
  async refund(
    @Kiosk() kiosk: KioskContext,
    @Body() body: ReturnDto,
  ): Promise<EdgePrintableReceipt> {
    const receipt = await this.returns.refund(kiosk.device.tillCode, cashierOf(kiosk), body);
    return this.ebarimt.afterCommit(kiosk.device.tillCode, receipt.clientId);
  }

  // ADR-0065: printing, the company lookup and the store PosAPI's list.

  /** A receipt to print: with its lottery and QR while the edge holds them, else a copy. */
  @Get('receipts/:clientId/print')
  print(
    @Kiosk() kiosk: KioskContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<EdgePrintableReceipt> {
    return this.ebarimt.printable(kiosk.device.tillCode, clientId);
  }

  @Get('ebarimt/taxpayer')
  taxpayer(@Query() query: TaxpayerQueryDto): Promise<EdgeTaxpayer> {
    return this.taxpayers.lookup(query.no);
  }

  @Get('ebarimt/queue')
  ebarimtQueue(): Promise<EdgeEbarimtQueue> {
    return this.ebarimt.queue();
  }

  @Post('ebarimt/:id/resolve')
  @HttpCode(204)
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EbarimtResolveDto,
  ): Promise<void> {
    const approver = await this.auth.approve(body.approval);
    await this.ebarimt.resolve(
      id,
      body.outcome,
      { ddtd: body.ddtd?.trim() || null, posapiDate: body.posapiDate?.trim() || null },
      approver?.userId ?? null,
    );
  }

  @Post('ebarimt/send-data')
  @HttpCode(200)
  async sendData(@Body() body: EbarimtSendDataDto): Promise<PosapiInfoWire> {
    await this.auth.approve(body.approval);
    return this.ebarimt.sendData();
  }
}
