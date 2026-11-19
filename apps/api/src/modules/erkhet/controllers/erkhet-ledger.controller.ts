import { Body, Controller, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  ErkhetLedgerLinkDto,
  ErkhetLedgerLinksQueryDto,
  ErkhetLedgerOverviewDto,
  ErkhetLedgerOwnDocumentsDto,
  ErkhetLedgerPartiesQueryDto,
  ErkhetLedgerPartyPageDto,
  ErkhetLedgerSettingsDto,
  ErkhetLedgerStartDto,
  StartErkhetLedgerRunDto,
  toLedgerOverviewDto,
  toLedgerPartyDto,
  toLedgerSettingsDto,
  toLedgerStartDto,
  toOwnDocumentDto,
  UpdateErkhetLedgerSettingsDto,
} from '../dto/erkhet-ledger.dto';
import { ErkhetLedgerService } from '../services/erkhet-ledger.service';

const READ = 'erkhet.sync.read';
const MANAGE = 'erkhet.sync.manage';
const SETTINGS = 'erkhet.settings.manage';

/**
 * «Авлага, өглөгийн гүйлгээ» (ADR-0219): Erkhet's receivable and payable transactions copied into
 * Bto's books. No route here reaches Erkhet: a run is the worker's, and it only reads.
 */
@ApiTags('erkhet')
@Controller('erkhet/ledger')
export class ErkhetLedgerController {
  constructor(private readonly ledger: ErkhetLedgerService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErkhetLedgerOverviewDto })
  async overview(): Promise<ErkhetLedgerOverviewDto> {
    return toLedgerOverviewDto(await this.ledger.overview());
  }

  @Patch('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErkhetLedgerSettingsDto })
  async updateSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateErkhetLedgerSettingsDto,
  ): Promise<ErkhetLedgerSettingsDto> {
    return toLedgerSettingsDto(await this.ledger.updateSettings(ctx, body));
  }

  /**
   * Starts a check, a post or a revert; the worker runs it and `GET erkhet/ledger` says when it
   * ended. A refusal is an answer (`started: false`), so the page can say what is missing.
   */
  @Post('runs')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ErkhetLedgerStartDto })
  async start(
    @CurrentUser() ctx: AuthContext,
    @Body() body: StartErkhetLedgerRunDto,
  ): Promise<ErkhetLedgerStartDto> {
    return toLedgerStartDto(await this.ledger.start(ctx, body));
  }

  /** The parties as Erkhet shows them, to hold against Erkhet's own receivable and payable report. */
  @Get('parties')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErkhetLedgerPartyPageDto })
  async parties(@Query() query: ErkhetLedgerPartiesQueryDto): Promise<ErkhetLedgerPartyPageDto> {
    const page = await this.ledger.parties(query);
    return { data: page.data.map(toLedgerPartyDto), nextCursor: page.nextCursor };
  }

  /** Bto's own documents on the copied accounts: with the copies they count twice. */
  @Get('own-documents')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErkhetLedgerOwnDocumentsDto })
  async ownDocuments(): Promise<ErkhetLedgerOwnDocumentsDto> {
    const found = await this.ledger.ownDocuments();
    return {
      data: found.data.map(toOwnDocumentDto),
      total: found.total.toFixed(2),
      truncated: found.truncated,
    };
  }

  /**
   * Where copied transactions open in Erkhet: an address, nothing of Erkhet's. The customer and
   * supplier ledgers show it, so it asks their right.
   */
  @Get('links')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: [ErkhetLedgerLinkDto] })
  links(@Query() query: ErkhetLedgerLinksQueryDto): Promise<ErkhetLedgerLinkDto[]> {
    return this.ledger.links(query.keys.split(','));
  }
}
