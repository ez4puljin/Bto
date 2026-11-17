import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  CreateSmsBatchDto,
  SettlementSmsCustomersDto,
  SettlementSmsCustomersQueryDto,
  SmsBatchDetailDto,
  SmsBatchDto,
  SmsBatchesQueryDto,
  SmsBatchPageDto,
  SmsCheckDto,
  SmsSettingsDto,
  SmsStatusDto,
  TestSmsSettingsDto,
  UpdateSmsSettingsDto,
} from '../dto/settlement-sms.dto';
import { SettlementSmsService, type SmsBatchView } from '../services/settlement-sms.service';
import {
  SmsSettingsFlowService,
  type SmsSettingsView,
} from '../services/sms-settings-flow.service';

const READ = 'finance.read';
const SEND = 'finance.sms.send';
/** The key is a provider's key like the AI's (ADR-0216). */
const MANAGE = 'ai.settings.manage';

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const batchDto = (view: SmsBatchView): SmsBatchDto => ({
  ...view,
  createdAt: view.createdAt.toISOString(),
  startedAt: iso(view.startedAt),
  finishedAt: iso(view.finishedAt),
});

const settingsDto = (view: SmsSettingsView): SmsSettingsDto => ({
  ...view,
  updatedAt: iso(view.updatedAt),
});

/** «Санхүү → Тооцооны SMS» (ADR-0216): the list, a batch and the history. */
@ApiTags('notifications')
@Controller('settlement-sms')
export class SettlementSmsController {
  constructor(
    private readonly sms: SettlementSmsService,
    private readonly settings: SmsSettingsFlowService,
  ) {}

  @Get('customers')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SettlementSmsCustomersDto })
  async customers(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SettlementSmsCustomersQueryDto,
  ): Promise<SettlementSmsCustomersDto> {
    const list = await this.sms.customerList(ctx, query);
    return {
      group: list.group,
      period: list.period,
      data: list.data.map((row) => ({
        ...row,
        balance: row.balance.toFixed(2),
        lastSentAt: iso(row.lastSentAt),
      })),
    };
  }

  /** Whether a key is saved and sending is on; WeSend is not asked. */
  @Get('status')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SmsStatusDto })
  async status(): Promise<SmsStatusDto> {
    const key = await this.settings.savedKey();
    return { ready: key.failure === null, reason: key.failure };
  }

  /** WeSend's balance for the dialog's estimate. */
  @Get('balance')
  @RequirePermission(SEND)
  @ApiOkResponse({ type: SmsCheckDto })
  balance(): Promise<SmsCheckDto> {
    return this.settings.test();
  }

  @Post('batches')
  @RequirePermission(SEND)
  @Idempotent()
  @ApiCreatedResponse({ type: SmsBatchDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateSmsBatchDto,
  ): Promise<SmsBatchDto> {
    return batchDto(await this.sms.createBatch(ctx, body));
  }

  @Get('batches')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SmsBatchPageDto })
  async batches(@Query() query: SmsBatchesQueryDto): Promise<SmsBatchPageDto> {
    const page = await this.sms.batches(query);
    return { data: page.data.map(batchDto), nextCursor: page.nextCursor };
  }

  @Get('batches/:id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SmsBatchDetailDto })
  async batch(@Param('id', ParseIntPipe) id: number): Promise<SmsBatchDetailDto> {
    const batch = await this.sms.batch(id);
    const messages = await this.sms.messages(id);
    return {
      batch: batchDto(batch),
      messages: messages.map((message) => ({
        ...message,
        balance: message.balance.toFixed(2),
        sentAt: iso(message.sentAt),
      })),
    };
  }
}

/** «Тохиргоо → SMS» (ADR-0216): WeSend's key, write-only, and the connection check. */
@ApiTags('notifications')
@Controller('sms/settings')
export class SmsSettingsController {
  constructor(private readonly settings: SmsSettingsFlowService) {}

  @Get()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SmsSettingsDto })
  async view(): Promise<SmsSettingsDto> {
    return settingsDto(await this.settings.view());
  }

  @Patch()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SmsSettingsDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateSmsSettingsDto,
  ): Promise<SmsSettingsDto> {
    return settingsDto(await this.settings.update(ctx, body));
  }

  /** Asks WeSend for the balance with the typed key, or the saved one; saves nothing, sends nothing. */
  @Post('test')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SmsCheckDto })
  test(@Body() body: TestSmsSettingsDto): Promise<SmsCheckDto> {
    return this.settings.test(body.apiKey);
  }
}
