import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import {
  Authenticated,
  type AuthContext,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  PriceLabelEscPosDto,
  PriceLabelEscPosRequestDto,
  PriceLabelItemDto,
  PriceLabelPrintRequestDto,
  PriceLabelPrintResultDto,
  PriceLabelSearchQueryDto,
  PriceLabelTillDto,
  PriceLabelTillQueryDto,
  PrintBridgeDoneRequestDto,
  PrintBridgeNextDto,
  PrintJobDto,
  PrintStationChoiceDto,
  PrintStationCreatedDto,
  PrintStationCreateRequestDto,
  PrintStationDto,
  PrintStationUpdateRequestDto,
} from '../dto/printing.dto';
import { itemDto, jobDto, stationChoiceDto, stationDto } from '../dto/printing.mappers';
import { PriceLabelsService } from '../services/price-labels.service';
import { PrintJobsService } from '../services/print-jobs.service';
import { PrintStationsService } from '../services/print-stations.service';

/**
 * Price labels from the staff app (ADR-0226). The routes are `@Authenticated()`: the right to print
 * is to be named as a cashier of a till (PRINT_NO_TILL otherwise), checked by the service.
 */
@ApiTags('printing')
@Controller()
export class PriceLabelsController {
  constructor(
    private readonly labels: PriceLabelsService,
    private readonly jobs: PrintJobsService,
  ) {}

  /** The caller's tills; PRINT_NO_TILL (403) without one. */
  @Get('price-labels/tills')
  @Authenticated()
  @ApiOkResponse({ type: [PriceLabelTillDto] })
  async tills(@CurrentUser() ctx: AuthContext): Promise<PriceLabelTillDto[]> {
    return (await this.labels.tillsOf(ctx)).map(({ id, code, name, storeName }) => ({
      id,
      code,
      name,
      storeName,
    }));
  }

  /** Up to 30 products the till sells, at its prices today; `q` empty answers nothing. */
  @Get('price-labels/products')
  @Authenticated()
  @ApiOkResponse({ type: [PriceLabelItemDto] })
  async products(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PriceLabelSearchQueryDto,
  ): Promise<PriceLabelItemDto[]> {
    const q = query.q?.trim() ?? '';
    if (q.length === 0) {
      await this.labels.till(ctx, query.tillId);
      return [];
    }
    return (await this.labels.search(ctx, query.tillId, q)).map(itemDto);
  }

  /** One product by a barcode (or its code); PRINT_PRODUCT_NOT_FOUND (404) if not sold there. */
  @Get('price-labels/barcode/:code')
  @Authenticated()
  @ApiOkResponse({ type: PriceLabelItemDto })
  async barcode(
    @CurrentUser() ctx: AuthContext,
    @Param('code') code: string,
    @Query() query: PriceLabelTillQueryDto,
  ): Promise<PriceLabelItemDto> {
    return itemDto(await this.labels.byCode(ctx, query.tillId, code));
  }

  /** The labels' ESC/POS bytes for the phone's Bluetooth printer; nothing is stored. */
  @Post('price-labels/escpos')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: PriceLabelEscPosDto })
  async escPos(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PriceLabelEscPosRequestDto,
  ): Promise<PriceLabelEscPosDto> {
    const { data, labels } = await this.labels.escPos(ctx, body, body.widthDots);
    return { data: data.toString('base64'), labels };
  }

  /** The printers a staff member with a till may send labels to. */
  @Get('print-stations')
  @Authenticated()
  @ApiOkResponse({ type: [PrintStationChoiceDto] })
  async stations(@CurrentUser() ctx: AuthContext): Promise<PrintStationChoiceDto[]> {
    return (await this.labels.stationsFor(ctx)).map(stationChoiceDto);
  }

  /** Queues the labels on a printer; poll GET /print-jobs/{jobId}. */
  @Post('price-labels/print')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: PriceLabelPrintResultDto })
  async print(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PriceLabelPrintRequestDto,
  ): Promise<PriceLabelPrintResultDto> {
    const { job, labels } = await this.labels.print(ctx, body);
    return { jobId: job.id, labels };
  }

  /** A job the caller made (or any, with `pos.manage`). */
  @Get('print-jobs/:id')
  @Authenticated()
  @ApiOkResponse({ type: PrintJobDto })
  async job(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PrintJobDto> {
    return jobDto(await this.jobs.get(ctx, id));
  }
}

/** The office's «Систем → Принтер» (ADR-0226 #6): `pos.manage`, the right over the store's tills. */
@ApiTags('printing')
@Controller('printing/stations')
export class PrintStationsController {
  constructor(
    private readonly stations: PrintStationsService,
    private readonly labels: PriceLabelsService,
  ) {}

  @Get()
  @RequirePermission('pos.manage')
  @ApiOkResponse({ type: [PrintStationDto] })
  async list(): Promise<PrintStationDto[]> {
    return (await this.stations.list()).map(stationDto);
  }

  /** A BRIDGE station's key comes back this once and is never stored in the replay. */
  @Post()
  @RequirePermission('pos.manage')
  @Idempotent({ storeWithout: ['key'] })
  @ApiCreatedResponse({ type: PrintStationCreatedDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PrintStationCreateRequestDto,
  ): Promise<PrintStationCreatedDto> {
    const { station, key } = await this.stations.create(ctx, {
      name: body.name,
      kind: body.kind === 'bridge' ? 'BRIDGE' : 'NETWORK',
      host: body.host ?? null,
      port: body.port ?? null,
      ...(body.widthDots ? { widthDots: body.widthDots } : {}),
    });
    return { station: stationDto(station), key };
  }

  @Put(':id')
  @RequirePermission('pos.manage')
  @ApiOkResponse({ type: PrintStationDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PrintStationUpdateRequestDto,
  ): Promise<PrintStationDto> {
    return stationDto(
      await this.stations.update(ctx, id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.host !== undefined ? { host: body.host } : {}),
        ...(body.port !== undefined ? { port: body.port } : {}),
        ...(body.widthDots !== undefined ? { widthDots: body.widthDots } : {}),
        ...(body.status !== undefined
          ? { status: body.status === 'active' ? 'ACTIVE' : 'DISABLED' }
          : {}),
      }),
    );
  }

  /** A BRIDGE station's new key (the old one stops); shown this once. */
  @Post(':id/key')
  @HttpCode(200)
  @RequirePermission('pos.manage')
  @ApiOkResponse({ type: PrintStationCreatedDto })
  async newKey(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PrintStationCreatedDto> {
    const { station, key } = await this.stations.newKey(ctx, id);
    return { station: stationDto(station), key };
  }

  /** «Туршилтын шошго»: one sample label; poll GET /print-jobs/{id}. */
  @Post(':id/test')
  @RequirePermission('pos.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: PrintJobDto })
  async test(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PrintJobDto> {
    return jobDto(await this.labels.test(ctx, id));
  }
}

/**
 * The print bridge on a Windows PC (`tools/print-bridge`, ADR-0226 #4). Not a staff member: the
 * routes are `@Public()` for the global guard and take the station's key as
 * `Authorization: Bearer bps_<station>_<secret>` (PRINT_KEY_INVALID, 401, otherwise).
 */
@ApiTags('printing')
@Public()
@Controller('print-bridge')
export class PrintBridgeController {
  constructor(
    private readonly stations: PrintStationsService,
    private readonly jobs: PrintJobsService,
  ) {}

  /** The station's next job, waiting up to about 25 s for one; `job: null` when none came. */
  @Get('next')
  @ApiHeader({ name: 'Authorization', description: 'Bearer bps_<station>_<secret>' })
  @ApiHeader({
    name: 'X-Printer-Name',
    required: false,
    description: 'The Windows printer the bridge writes to (shown in the office)',
  })
  @ApiOkResponse({ type: PrintBridgeNextDto })
  async next(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-printer-name') printerName: string | undefined,
    @Req() request: Request,
  ): Promise<PrintBridgeNextDto> {
    const station = await this.stations.authenticate(bearer(authorization), printerName ?? null);
    const hangUp = new AbortController();
    request.once('close', () => hangUp.abort());
    const job = await this.jobs.next(station, hangUp.signal);
    return {
      job: job ? { id: job.id, labels: job.labels, data: job.payload.toString('base64') } : null,
    };
  }

  /** The bridge's report on a job it took. */
  @Post('jobs/:id/done')
  @HttpCode(200)
  @ApiHeader({ name: 'Authorization', description: 'Bearer bps_<station>_<secret>' })
  @ApiOkResponse({ type: PrintJobDto })
  async done(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PrintBridgeDoneRequestDto,
  ): Promise<PrintJobDto> {
    const station = await this.stations.authenticate(bearer(authorization));
    return jobDto(await this.jobs.finish(station, id, { ok: body.ok, message: body.message }));
  }
}

function bearer(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}
