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
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  ErxesCheckDto,
  ErxesDealChoiceDto,
  ErxesDealDto,
  ErxesDealPageDto,
  ErxesDealsQueryDto,
  ErxesOrderDealDto,
  ErxesPipelineDto,
  ErxesPullResultDto,
  ErxesRangeCopyDto,
  ErxesRangeCopyRequestDto,
  ErxesRangePipelineDto,
  ErxesRangePreviewDto,
  ErxesRangeRequestDto,
  ErxesSettingsDto,
  ErxesUserDto,
  TestErxesSettingsDto,
  UpdateErxesPipelineDto,
  UpdateErxesSettingsDto,
  UpdateErxesUserDto,
} from '../dto/erxes.dto';
import { ErxesCopyService } from '../services/erxes-copy.service';
import { ErxesDealsService } from '../services/erxes-deals.service';
import { ErxesDirectoryFlowService } from '../services/erxes-directory-flow.service';
import { ErxesPullFlowService } from '../services/erxes-pull-flow.service';
import { ErxesRangeFlowService } from '../services/erxes-range-flow.service';
import { ErxesSettingsFlowService } from '../services/erxes-settings-flow.service';

/** Switching the copy on, the pipelines and the users (ADR-0218 #9): who configures the boards. */
const SETTINGS = 'sales.boards.manage';
/** The list «Erxes-ээс ирсэн» and its buttons: who manages orders. */
const DEALS = 'sales.orders.manage';
/** The order panel's «Erxes» section: who reads orders. */
const READ = 'sales.orders.read';

/**
 * erxes's deals copied into Bto as draft orders (ADR-0218). No response ever carries the erxes
 * password or its session, and no route writes to erxes.
 */
@ApiTags('erxes')
@Controller('erxes')
export class ErxesController {
  constructor(
    private readonly settings: ErxesSettingsFlowService,
    private readonly directory: ErxesDirectoryFlowService,
    private readonly puller: ErxesPullFlowService,
    private readonly deals: ErxesDealsService,
    private readonly copier: ErxesCopyService,
    private readonly range: ErxesRangeFlowService,
  ) {}

  @Get('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErxesSettingsDto })
  viewSettings(): Promise<ErxesSettingsDto> {
    return this.settings.view();
  }

  @Patch('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErxesSettingsDto })
  updateSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateErxesSettingsDto,
  ): Promise<ErxesSettingsDto> {
    return this.settings.update(ctx, body);
  }

  /** Signs in to erxes with what is typed or saved; saves nothing and reads nothing. */
  @Post('settings/test')
  @HttpCode(200)
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErxesCheckDto })
  testSettings(@Body() body: TestErxesSettingsDto): Promise<ErxesCheckDto> {
    return this.settings.test(body);
  }

  @Get('pipelines')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: [ErxesPipelineDto] })
  pipelines(@CurrentUser() ctx: AuthContext): Promise<ErxesPipelineDto[]> {
    return this.directory.pipelines(ctx);
  }

  /** Reads erxes's boards, pipelines and users again; ticks nothing. */
  @Post('pipelines/refresh')
  @HttpCode(200)
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErxesCheckDto })
  refresh(@CurrentUser() ctx: AuthContext): Promise<ErxesCheckDto> {
    return this.directory.refresh(ctx);
  }

  @Patch('pipelines/:id')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: [ErxesPipelineDto] })
  async updatePipeline(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateErxesPipelineDto,
  ): Promise<ErxesPipelineDto[]> {
    await this.directory.updatePipeline(ctx, id, body);
    return this.directory.pipelines(ctx);
  }

  @Get('users')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: [ErxesUserDto] })
  users(): Promise<ErxesUserDto[]> {
    return this.directory.users();
  }

  @Patch('users/:id')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: [ErxesUserDto] })
  async mapUser(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateErxesUserDto,
  ): Promise<ErxesUserDto[]> {
    await this.directory.mapUser(ctx, id, body.btoUserId);
    return this.directory.users();
  }

  /** «Одоо татах»: one pull now, as the worker does every minute. */
  @Post('pull')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesPullResultDto })
  pull(): Promise<ErxesPullResultDto> {
    return this.puller.pull();
  }

  /** The pipelines a range may read (ADR-0220): not blocked, with their Bto place chosen. */
  @Get('range/pipelines')
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: [ErxesRangePipelineDto] })
  rangePipelines(): Promise<ErxesRangePipelineDto[]> {
    return this.range.pipelines();
  }

  /** «Харах»: the deals created in the range, newest first, with what Bto holds of each. */
  @Post('range/preview')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesRangePreviewDto })
  rangePreview(@Body() body: ErxesRangeRequestDto): Promise<ErxesRangePreviewDto> {
    return this.range.preview(body);
  }

  /**
   * «Bto руу хуулах» of a range: the ticked deals, a part at a time, by the minute pull's rules.
   * A deal Bto holds already is skipped, so sending a part again makes nothing twice.
   */
  @Post('range/copy')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesRangeCopyDto })
  rangeCopy(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ErxesRangeCopyRequestDto,
  ): Promise<ErxesRangeCopyDto> {
    return this.range.copy(ctx, body);
  }

  @Get('deals')
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealPageDto })
  list(@Query() query: ErxesDealsQueryDto): Promise<ErxesDealPageDto> {
    return this.deals.list(query);
  }

  @Get('deals/:id')
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealDto })
  deal(@Param('id', ParseIntPipe) id: number): Promise<ErxesDealDto> {
    return this.deals.get(id);
  }

  /** The customer, or a line's product, a person chose for a waiting deal. */
  @Patch('deals/:id')
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealDto })
  choose(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ErxesDealChoiceDto,
  ): Promise<ErxesDealDto> {
    return this.deals.choose(ctx, id, body);
  }

  /**
   * «Bto руу хуулах»: tries the deal now. The answer is the deal: an order's id when it was
   * copied, the reasons when it still waits. A deal already copied answers the same order.
   */
  @Post('deals/:id/copy')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealDto })
  async copy(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ErxesDealDto> {
    await this.copier.tryCopy(id, ctx);
    return this.deals.get(id);
  }

  @Post('deals/:id/dismiss')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealDto })
  dismiss(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ErxesDealDto> {
    return this.deals.dismiss(ctx, id);
  }

  @Post('deals/:id/restore')
  @HttpCode(200)
  @RequirePermission(DEALS)
  @ApiOkResponse({ type: ErxesDealDto })
  restore(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ErxesDealDto> {
    return this.deals.restore(ctx, id);
  }

  /** The deal an order was copied from, for the order panel; `deal` is null for Bto's own orders. */
  @Get('orders/:orderId/deal')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErxesOrderDealDto })
  async orderDeal(
    @CurrentUser() ctx: AuthContext,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<ErxesOrderDealDto> {
    return { deal: await this.deals.ofOrder(ctx, orderId) };
  }
}
