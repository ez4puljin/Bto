import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PageQueryDto } from '../../../common/pagination/page';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  PhoneCallbackCloseRequestDto,
  PhoneCallbackDto,
  PhoneCallbackPageDto,
  PhoneCallbackQueryDto,
  PhoneCallDetailDto,
  PhoneCallDto,
  PhoneCallPageDto,
  PhoneCallQueryDto,
  PhoneLineCreatedDto,
  PhoneLineCreateRequestDto,
  PhoneLineDto,
  PhoneLineUpdateRequestDto,
  PhoneNoHitSearchPageDto,
} from '../dto/phone-agent.dto';
import {
  type PhoneCallbackView,
  PhoneCallsService,
  type PhoneCallView,
} from '../services/phone-calls.service';
import { type PhoneLine, PhoneLinesService, staffAnswer } from '../services/phone-lines.service';

const LINES = 'phone.lines.manage';
const CALLS = 'phone.calls.read';

const lineDto = (line: PhoneLine): PhoneLineDto => ({
  id: line.id,
  name: line.name,
  active: line.active,
  schedule: {
    week: Object.fromEntries(
      Object.entries(line.schedule.week).map(([day, intervals]) => [
        day,
        intervals.map(([from, to]): [string, string] => [from, to]),
      ]),
    ),
    exceptions: line.schedule.exceptions.map((entry) => ({
      date: entry.date,
      intervals: entry.intervals.map(([from, to]): [string, string] => [from, to]),
    })),
  },
  greeting: line.greeting,
  lastSeenAt: line.lastSeenAt?.toISOString() ?? null,
  online: line.online,
  workingHours: staffAnswer(line, new Date()),
  createdAt: line.createdAt.toISOString(),
  updatedAt: line.updatedAt.toISOString(),
});

const callDto = (call: PhoneCallView): PhoneCallDto => ({
  id: call.id,
  lineId: call.lineId,
  lineName: call.lineName,
  callerPhone: call.callerPhone,
  callerRaw: call.callerRaw,
  customerId: call.customerId,
  customerName: call.customerName,
  answered: call.answered,
  declineReason: call.declineReason,
  startedAt: call.startedAt.toISOString(),
  endedAt: call.endedAt?.toISOString() ?? null,
  endReason: call.endReason,
  durationS: call.durationS,
  outcome: call.outcome,
  salesOrderId: call.salesOrderId,
  orderNumber: call.orderNumber,
  costEstimate: call.costEstimate,
  reconciled: call.reconciled,
});

const callbackDto = (callback: PhoneCallbackView): PhoneCallbackDto => ({
  ...callback,
  doneAt: callback.doneAt?.toISOString() ?? null,
  createdAt: callback.createdAt.toISOString(),
});

/** «Систем → Утасны AI шугам» (ADR-0232 #10): the lines, their hours, greeting and key. */
@ApiTags('phone-agent')
@Controller('phone-lines')
export class PhoneLinesController {
  constructor(private readonly lines: PhoneLinesService) {}

  @Get()
  @RequirePermission(LINES)
  @ApiOkResponse({ type: [PhoneLineDto] })
  async list(): Promise<PhoneLineDto[]> {
    return (await this.lines.list()).map(lineDto);
  }

  /** A new line, switched off; its key comes back this once and is never stored in the replay. */
  @Post()
  @RequirePermission(LINES)
  @Idempotent({ storeWithout: ['key'] })
  @ApiCreatedResponse({ type: PhoneLineCreatedDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PhoneLineCreateRequestDto,
  ): Promise<PhoneLineCreatedDto> {
    const { line, key } = await this.lines.create(ctx, {
      name: body.name,
      ...(body.schedule === undefined ? {} : { schedule: body.schedule }),
      greeting: body.greeting ?? null,
    });
    return { line: lineDto(line), key };
  }

  /** The name, the working hours, the greeting, and on or off. */
  @Put(':id')
  @RequirePermission(LINES)
  @ApiOkResponse({ type: PhoneLineDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PhoneLineUpdateRequestDto,
  ): Promise<PhoneLineDto> {
    return lineDto(
      await this.lines.update(ctx, id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.schedule === undefined ? {} : { schedule: body.schedule }),
        ...(body.greeting === undefined ? {} : { greeting: body.greeting }),
      }),
    );
  }

  /** The station's new key (the old one stops at once); shown this once. */
  @Post(':id/key')
  @HttpCode(200)
  @RequirePermission(LINES)
  @Idempotent({ storeWithout: ['key'] })
  @ApiOkResponse({ type: PhoneLineCreatedDto })
  async rotateKey(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PhoneLineCreatedDto> {
    const { line, key } = await this.lines.rotateKey(ctx, id);
    return { line: lineDto(line), key };
  }
}

/**
 * «Борлуулалт → Утасны дуудлага» (ADR-0232 #10): the calls with their transcripts, the callbacks
 * to work through and the searches that found nothing.
 */
@ApiTags('phone-agent')
@Controller()
export class PhoneCallsController {
  constructor(private readonly calls: PhoneCallsService) {}

  @Get('phone-calls')
  @RequirePermission(CALLS)
  @ApiOkResponse({ type: PhoneCallPageDto })
  async list(@Query() query: PhoneCallQueryDto): Promise<PhoneCallPageDto> {
    const page = await this.calls.page({
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.answered === undefined ? {} : { answered: query.answered === 'true' }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return { data: page.data.map(callDto), nextCursor: page.nextCursor };
  }

  /** One call with its transcript in the order it was spoken. */
  @Get('phone-calls/:id')
  @RequirePermission(CALLS)
  @ApiOkResponse({ type: PhoneCallDetailDto })
  async detail(@Param('id', ParseIntPipe) id: number): Promise<PhoneCallDetailDto> {
    const { call, messages } = await this.calls.detail(id);
    return {
      call: callDto(call),
      messages: messages.map((message) => ({
        ...message,
        meta: message.meta,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  @Get('phone-callbacks')
  @RequirePermission(CALLS)
  @ApiOkResponse({ type: PhoneCallbackPageDto })
  async callbacks(@Query() query: PhoneCallbackQueryDto): Promise<PhoneCallbackPageDto> {
    const page = await this.calls.callbacks({
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return { data: page.data.map(callbackDto), nextCursor: page.nextCursor };
  }

  /** «Залгасан» or «Орхих»: only an open task closes (PHONE_CALLBACK_STATE, 409, otherwise). */
  @Post('phone-callbacks/:id/close')
  @HttpCode(200)
  @RequirePermission(CALLS)
  @Idempotent()
  @ApiOkResponse({ type: PhoneCallbackDto })
  async closeCallback(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PhoneCallbackCloseRequestDto,
  ): Promise<PhoneCallbackDto> {
    return callbackDto(await this.calls.closeCallback(ctx, id, body.status));
  }

  /** «Олдоогүй хайлтууд»: what callers asked for and the catalog did not find. */
  @Get('phone-searches/no-hits')
  @RequirePermission(CALLS)
  @ApiOkResponse({ type: PhoneNoHitSearchPageDto })
  async noHits(@Query() query: PageQueryDto): Promise<PhoneNoHitSearchPageDto> {
    const page = await this.calls.noHits({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      data: page.data.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }
}
