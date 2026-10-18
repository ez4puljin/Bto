import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import { ContactDto, ContactRequestDto, NextCodeDto } from '../dto/common.dto';
import {
  AddressDto,
  AddressRequestDto,
  CreateAddressDto,
  CreateCustomerDto,
  CreditDto,
  CustomerDetailDto,
  CustomerListQueryDto,
  CustomerLookupDto,
  CustomerLookupQueryDto,
  CustomerPageDto,
  UpdateCustomerDto,
} from '../dto/customers.dto';
import { PartnerSegmentsService } from '../services/partner-segments.service';
import { CustomerContactsService } from '../services/contacts.service';
import { CustomerAddressesService } from '../services/customer-addresses.service';
import { CustomersService } from '../services/customers.service';
import {
  toAddressDto,
  toAddressInput,
  toContactDto,
  toCustomerDetailDto,
  toCustomerListItemDto,
} from './mappers';

const READ = 'partners.customers.read';
const MANAGE = 'partners.customers.manage';
const CREDIT = 'partners.credit.manage';

@ApiTags('partners')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly contacts: CustomerContactsService,
    private readonly segments: PartnerSegmentsService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: CustomerListQueryDto,
  ): Promise<CustomerPageDto> {
    const within = await this.segments.within(ctx, 'CUSTOMER', query.segmentId);
    const page = await this.customers.listItems(ctx, query, within);
    return { data: page.data.map(toCustomerListItemDto), nextCursor: page.nextCursor };
  }

  /** Active customers by name or code for pickers anyone signed in may use (ADR-0081 #6). */
  @Get('lookup')
  @Authenticated()
  @ApiOkResponse({ type: [CustomerLookupDto] })
  async lookup(
    @CurrentUser() ctx: AuthContext,
    @Query() query: CustomerLookupQueryDto,
  ): Promise<CustomerLookupDto[]> {
    const page = await this.customers.list(ctx, { q: query.q, status: 'ACTIVE', limit: 20 });
    return page.data.map(({ id, code, name }) => ({ id, code, name }));
  }

  /** Declared before `:id`, so "next-code" never reaches ParseIntPipe. */
  @Get('next-code')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NextCodeDto })
  async nextCode(): Promise<NextCodeDto> {
    return { code: await this.customers.nextCode() };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<CustomerDetailDto> {
    return toCustomerDetailDto(await this.customers.get(id));
  }

  /** Idempotent: the server allocates the code when it is omitted, so a retry must not add a twin. */
  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: CustomerDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateCustomerDto,
  ): Promise<CustomerDetailDto> {
    const { address, ...fields } = body;
    const created = await this.customers.create(ctx, {
      ...fields,
      address: address ? toAddressInput(address) : null,
    });
    return toCustomerDetailDto(created);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CustomerDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCustomerDto,
  ): Promise<CustomerDetailDto> {
    return toCustomerDetailDto(await this.customers.update(ctx, id, body));
  }

  /** Credit limit, payment term and hold: the accountant's (partners.credit.manage). */
  @Put(':id/credit')
  @RequirePermission(CREDIT)
  @ApiOkResponse({ type: CustomerDetailDto })
  async setCredit(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreditDto,
  ): Promise<CustomerDetailDto> {
    const updated = await this.customers.setCredit(ctx, id, {
      creditLimit: body.creditLimit ? new Decimal(body.creditLimit) : null,
      paymentTermDays: body.paymentTermDays ?? null,
      creditHold: body.creditHold,
      creditHoldReason: body.creditHoldReason ?? null,
    });
    return toCustomerDetailDto(updated);
  }

  @Get(':id/addresses')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [AddressDto] })
  async listAddresses(@Param('id', ParseIntPipe) id: number): Promise<AddressDto[]> {
    await this.customers.get(id);
    return (await this.addresses.ofCustomer(id)).map(toAddressDto);
  }

  @Post(':id/addresses')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: AddressDto })
  async addAddress(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateAddressDto,
  ): Promise<AddressDto> {
    return toAddressDto(
      await this.addresses.add(ctx, id, toAddressInput(body), body.isDefault === true),
    );
  }

  @Get(':id/contacts')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [ContactDto] })
  async listContacts(@Param('id', ParseIntPipe) id: number): Promise<ContactDto[]> {
    await this.customers.get(id);
    return (await this.contacts.ofCustomer(id)).map(toContactDto);
  }

  @Post(':id/contacts')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ContactDto })
  async addContact(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ContactRequestDto,
  ): Promise<ContactDto> {
    return toContactDto(await this.contacts.add(ctx, id, body));
  }
}

@ApiTags('partners')
@Controller('customer-addresses')
export class CustomerAddressesController {
  constructor(private readonly addresses: CustomerAddressesService) {}

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: AddressDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AddressRequestDto,
  ): Promise<AddressDto> {
    return toAddressDto(await this.addresses.update(ctx, id, toAddressInput(body)));
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: AddressDto })
  async setDefault(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AddressDto> {
    return toAddressDto(await this.addresses.setDefault(ctx, id));
  }

  /** Archives the address: orders keep pointing at it; the oldest other one becomes the default. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.addresses.archive(ctx, id);
  }
}

@ApiTags('partners')
@Controller('customer-contacts')
export class CustomerContactsController {
  constructor(private readonly contacts: CustomerContactsService) {}

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ContactDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ContactRequestDto,
  ): Promise<ContactDto> {
    return toContactDto(await this.contacts.update(ctx, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.contacts.remove(ctx, id);
  }
}
