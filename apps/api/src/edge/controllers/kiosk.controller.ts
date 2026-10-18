import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeBarcodeHit,
  EdgeDeviceInfo,
  EdgeHealth,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgeProductHit,
  EdgeQuoteResponse,
  EdgeReceipt,
  EdgeSession,
  EdgeShiftSummary,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeState } from '../db/schema';
import {
  LoginDto,
  PairDto,
  QuoteDto,
  SaleDto,
  SearchQueryDto,
  ShiftCloseDto,
  ShiftOpenDto,
} from '../dto/kiosk.dto';
import {
  cashierOf,
  DeviceOnly,
  EdgePublic,
  Kiosk,
  type KioskContext,
  KioskGuard,
} from '../guards/kiosk.guard';
import { CheckoutService } from '../services/checkout.service';
import { DevicesService } from '../services/devices.service';
import { KioskAuthService } from '../services/kiosk-auth.service';
import { OutboxService } from '../services/outbox.service';
import { EdgeShiftsService } from '../services/shifts.service';
import { SnapshotStore } from '../services/snapshot.store';

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
  sell(@Kiosk() kiosk: KioskContext, @Body() body: SaleDto): Promise<EdgeReceipt> {
    return this.checkout.sell(kiosk.device.tillCode, cashierOf(kiosk), body);
  }

  @Get('sales/recent')
  recent(@Kiosk() kiosk: KioskContext): Promise<EdgeReceipt[]> {
    return this.checkout.recent(kiosk.device.tillCode);
  }
}
