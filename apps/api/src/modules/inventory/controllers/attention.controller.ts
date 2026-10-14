import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ATTENTION_CAP } from '../../../common/attention';
import { type AuthContext, Authenticated, CurrentUser } from '../../identity';
import { InventoryAttentionDto } from '../dto/attention.dto';
import { InventoryAttentionService } from '../services/attention.service';

/** The home page's inventory tiles (ADR-0047 #7): every signed-in user, counted by their rights. */
@ApiTags('inventory')
@Controller('inventory/attention')
export class InventoryAttentionController {
  constructor(private readonly attention: InventoryAttentionService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: InventoryAttentionDto })
  async counts(@CurrentUser() ctx: AuthContext): Promise<InventoryAttentionDto> {
    return { ...(await this.attention.counts(ctx)), cap: ATTENTION_CAP };
  }
}
