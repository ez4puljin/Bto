import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext, CustomerContext } from '../auth-context';
import {
  Authenticated,
  CurrentCustomer,
  CurrentUser,
  CustomerRoute,
  RequirePermission,
} from '../decorators/access.decorators';
import { ScreenUsageListDto, ScreenUsageQueryDto, ScreenUsageRequestDto } from '../dto/usage.dto';
import { UsageService } from '../services/usage.service';

/**
 * Which screens are used (ADR-0197). The office web and the staff app send their counts here once
 * a minute; a send is answered 204 whatever it held, so counting never troubles the work it counts.
 * Reading the figures is the audit reader's right.
 */
@ApiTags('usage')
@Controller('usage/screens')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Post()
  @HttpCode(204)
  @Authenticated()
  @ApiNoContentResponse()
  async record(@CurrentUser() ctx: AuthContext, @Body() body: ScreenUsageRequestDto) {
    // A staff token cannot count for the stores' app.
    if (body.app === 'customer') return;
    await this.usage.record({ kind: 'staff', id: ctx.userId }, body.app, body.events);
  }

  @Get()
  @RequirePermission('identity.audit.read')
  @ApiOkResponse({ type: ScreenUsageListDto })
  async summary(@Query() query: ScreenUsageQueryDto): Promise<ScreenUsageListDto> {
    return { data: await this.usage.summary(query.from, query.to) };
  }
}

/** The same count from «Bto300» (ADR-0197): under the app's own routes, so the app replicas take it. */
@ApiTags('usage')
@Controller('customer-app/usage/screens')
export class CustomerUsageController {
  constructor(private readonly usage: UsageService) {}

  @Post()
  @HttpCode(204)
  @CustomerRoute()
  @ApiNoContentResponse()
  async record(@CurrentCustomer() ctx: CustomerContext, @Body() body: ScreenUsageRequestDto) {
    await this.usage.record({ kind: 'customer', id: ctx.customerId }, 'customer', body.events);
  }
}
