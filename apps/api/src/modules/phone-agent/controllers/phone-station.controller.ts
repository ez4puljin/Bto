import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/public.decorator';
import { Idempotent } from '../../identity';
import {
  PhoneCallEndDto,
  PhoneCallEndRequestDto,
  PhoneCallEventsRequestDto,
  PhoneCallEventsResultDto,
  PhoneCallStartDto,
  PhoneCallStartRequestDto,
  PhoneStationStatusDto,
  PhoneToolAnswerDto,
  PhoneToolCallRequestDto,
} from '../dto/phone-agent.dto';
import { CurrentPhoneLine, PhoneLineGuard } from '../guards/phone-line.guard';
import { PhoneCallFlowService } from '../services/phone-call-flow.service';
import { PhoneCallsService } from '../services/phone-calls.service';
import type { PhoneLine } from '../services/phone-lines.service';
import { PhoneToolsService } from '../services/phone-tools.service';

const KEY_HEADER = { name: 'Authorization', description: 'Bearer bpl_<line>_<secret>' };

/**
 * The phone line's station: the Windows bridge beside the Android phone (`tools/call-bridge`,
 * ADR-0232 #3). Not a staff member: the routes are `@Public()` for the global guard and take the
 * line's key as `Authorization: Bearer bpl_<line>_<secret>` (PHONE_KEY_INVALID, 401, otherwise).
 * Every route that writes takes an `Idempotency-Key`, kept per line.
 */
@ApiTags('phone-agent')
@Public()
@UseGuards(PhoneLineGuard)
@ApiHeader(KEY_HEADER)
@Controller('phone-agent')
export class PhoneStationController {
  constructor(
    private readonly flow: PhoneCallFlowService,
    private readonly calls: PhoneCallsService,
    private readonly tools: PhoneToolsService,
  ) {}

  /** The station's heartbeat: marks it seen and says whether the AI would answer now. */
  @Get('station')
  @ApiOkResponse({ type: PhoneStationStatusDto })
  station(@CurrentPhoneLine() line: PhoneLine): PhoneStationStatusDto {
    return this.flow.status(line);
  }

  /**
   * An incoming call: `answer: false` leaves the phone ringing for staff. The signed URL is for
   * this call only and is left out of the stored replay: an answer replayed by the
   * Idempotency-Key carries none, and the bridge then does not pick up.
   */
  @Post('calls')
  @Idempotent({ storeWithout: ['signedUrl'] })
  @ApiCreatedResponse({ type: PhoneCallStartDto })
  async start(
    @CurrentPhoneLine() line: PhoneLine,
    @Body() body: PhoneCallStartRequestDto,
  ): Promise<PhoneCallStartDto> {
    const started = await this.flow.start(line, {
      callRef: body.callRef,
      callerPhone: body.callerPhone ?? null,
    });
    return started.answer
      ? { ...started, reason: null }
      : { ...started, signedUrl: null, dynamicVariables: null };
  }

  /** The turns of the conversation in the provider's order; a batch sent twice changes nothing. */
  @Post('calls/:id/events')
  @HttpCode(200)
  @Idempotent()
  @ApiOkResponse({ type: PhoneCallEventsResultDto })
  events(
    @CurrentPhoneLine() line: PhoneLine,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PhoneCallEventsRequestDto,
  ): Promise<PhoneCallEventsResultDto> {
    return this.calls.appendEvents(line, id, {
      events: body.events,
      conversationId: body.conversationId ?? null,
    });
  }

  /** One of the agent's client tools; a refusal is a problem+json whose `code` the agent is told. */
  @Post('calls/:id/tools/:name')
  @HttpCode(200)
  @Idempotent()
  @ApiOkResponse({ type: PhoneToolAnswerDto })
  async tool(
    @CurrentPhoneLine() line: PhoneLine,
    @Param('id', ParseIntPipe) id: number,
    @Param('name') name: string,
    @Body() body: PhoneToolCallRequestDto,
  ): Promise<PhoneToolAnswerDto> {
    return {
      answer: await this.tools.run(line, id, name, {
        afterSeq: body.afterSeq,
        seq: body.seq,
        atMs: body.atMs ?? null,
        args: body.args,
      }),
    };
  }

  /** The call is over: its outcome, and the job that fills the turns never delivered. */
  @Post('calls/:id/end')
  @HttpCode(200)
  @Idempotent()
  @ApiOkResponse({ type: PhoneCallEndDto })
  async end(
    @CurrentPhoneLine() line: PhoneLine,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PhoneCallEndRequestDto,
  ): Promise<PhoneCallEndDto> {
    const call = await this.calls.end(line, id, {
      reason: body.reason,
      durationS: body.durationS ?? null,
      conversationId: body.conversationId ?? null,
    });
    return { callId: call.id, outcome: call.outcome, orderNumber: call.orderNumber };
  }
}
