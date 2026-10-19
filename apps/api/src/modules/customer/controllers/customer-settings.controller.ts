import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  CurrentUser,
  CustomerAccountsService,
  RequirePermission,
} from '../../identity';
import { SalesPipelinesService } from '../../sales';
import {
  CompanyContactDto,
  CompanyContactsRequestDto,
  CustomerAppAttentionDto,
} from '../dto/customer-app.dto';
import { CompanyContactsService } from '../services/company-contacts.service';

/**
 * The staff side of the customer app (ADR-0079 #5, #14): the «Харилцагчийн апп» settings page's
 * contact list, and whether app orders are accepted (the admin's home warning).
 */
@ApiTags('customer')
@Controller('customer')
export class CustomerSettingsController {
  constructor(
    private readonly contacts: CompanyContactsService,
    private readonly accounts: CustomerAccountsService,
    private readonly pipelines: SalesPipelinesService,
  ) {}

  @Get('contacts')
  @RequirePermission('identity.settings.read')
  @ApiOkResponse({ type: [CompanyContactDto] })
  list(): Promise<CompanyContactDto[]> {
    return this.contacts.list();
  }

  /** The whole list in its order (role, name, phone, shown). */
  @Put('contacts')
  @RequirePermission('identity.settings.manage')
  @ApiOkResponse({ type: [CompanyContactDto] })
  save(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CompanyContactsRequestDto,
  ): Promise<CompanyContactDto[]> {
    return this.contacts.save(ctx, body.contacts);
  }

  /** The home's warning when stores use the app but no stage takes its orders. */
  @Get('attention')
  @RequirePermission('sales.boards.manage')
  @ApiOkResponse({ type: CustomerAppAttentionDto })
  async attention(): Promise<CustomerAppAttentionDto> {
    return {
      activeAccounts: await this.accounts.activeCount(),
      ordersOpen: await this.pipelines.customerAppOpen(),
    };
  }
}
