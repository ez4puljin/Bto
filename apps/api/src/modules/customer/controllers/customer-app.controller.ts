import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { CUSTOMER_ORDER_MAX_DAYS, customerOrderStateOf } from '@tugeel/shared/sales';
import { addDays } from '@tugeel/shared/time';
import { type CustomerContext, CurrentCustomer, CustomerRoute, Idempotent } from '../../identity';
import { CustomerInboxService } from '../../notifications';
import { toQuoteDto } from '../../pricing';
import {
  CompanyContactDto,
  CustomerAppBalanceDto,
  CustomerAppBankAccountDto,
  CustomerAppBarcodeDto,
  CustomerAppCategoryDto,
  CustomerAppCheckoutDto,
  CustomerAppCreditCheckDto,
  CustomerAppCreditCheckQueryDto,
  CustomerAppFavouritesDto,
  CustomerAppInvoiceDetailDto,
  CustomerAppInvoiceDto,
  CustomerAppMeDto,
  CustomerAppNotificationPageDto,
  CustomerAppNotificationSummaryDto,
  CustomerAppOrderDto,
  CustomerAppOrderListQueryDto,
  CustomerAppOrderPageDto,
  CustomerAppOrderRepsDto,
  CustomerAppOrderRequestDto,
  CustomerAppPaymentPageDto,
  CustomerAppProductBatchQueryDto,
  CustomerAppProductDto,
  CustomerAppProductPageDto,
  CustomerAppProductQueryDto,
  CustomerAppQuoteDto,
  CustomerAppQuoteRequestDto,
  CustomerAppReadRequestDto,
  CustomerAppReadResultDto,
  CustomerAppReorderDto,
  CustomerAppStatementDto,
  CustomerAppStatementQueryDto,
  CustomerAppThumbsDto,
} from '../dto/customer-app.dto';
import { PageQueryDto } from '../../../common/pagination/page';
import { CompanyContactsService } from '../services/company-contacts.service';
import { CustomerAccountService } from '../services/customer-account.service';
import { CustomerAppOrdersService } from '../services/customer-app-orders.service';
import { CustomerShopService } from '../services/customer-shop.service';
import {
  accountDto,
  cents,
  invoiceDetailDto,
  invoiceDto,
  noticeDto,
  notificationDto,
  orderDto,
  orderRowDto,
  paymentDto,
  productDto,
  statementDto,
  whole,
} from './mappers';

/*
 * The customer app «Bto300» (ADR-0079, ADR-0082): every route is @CustomerRoute() — only a
 * customer token reaches it, and the store is always the token's own (`@CurrentCustomer()`); no
 * route takes a customer id from the client. Another store's order or invoice answers 404, as one
 * that does not exist.
 */

/** «Нүүр», «Профайл», the checkout and «Холбоо барих». */
@ApiTags('customer-app')
@Controller('customer-app')
export class CustomerAppStoreController {
  constructor(
    private readonly account: CustomerAccountService,
    private readonly contacts: CompanyContactsService,
  ) {}

  @Get('me')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppMeDto })
  me(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppMeDto> {
    return this.account.me(ctx);
  }

  @Get('checkout')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppCheckoutDto })
  async checkout(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppCheckoutDto> {
    const checkout = await this.account.checkout(ctx);
    return { ...checkout, lastDay: addDays(checkout.today, CUSTOMER_ORDER_MAX_DAYS) };
  }

  /** The cart's credit warning for its quoted total (ADR-0079 #5): the store may still send. */
  @Get('credit-check')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppCreditCheckDto })
  async creditCheck(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: CustomerAppCreditCheckQueryDto,
  ): Promise<CustomerAppCreditCheckDto> {
    const check = await this.account.creditCheck(ctx, new Decimal(query.amount));
    return {
      warnings: check.warnings,
      overdueAmount: cents(check.overdueAmount),
      oldestOverdueDate: check.oldestOverdueDate,
      creditLimit: check.creditLimit === null ? null : cents(check.creditLimit),
      creditAvailable: check.creditAvailable === null ? null : cents(check.creditAvailable),
      excess: cents(check.excess),
    };
  }

  /** «Холбоо барих» (ADR-0079 #14): the company's contact people the admins show. */
  @Get('contacts')
  @CustomerRoute()
  @ApiOkResponse({ type: [CompanyContactDto] })
  contactList(): Promise<CompanyContactDto[]> {
    return this.contacts.shown();
  }
}

/** «Бараа»: the shop, the scanner, ★ and the cart's quote (ADR-0079 #4). */
@ApiTags('customer-app')
@Controller('customer-app')
export class CustomerAppShopController {
  constructor(private readonly shop: CustomerShopService) {}

  @Get('categories')
  @CustomerRoute()
  @ApiOkResponse({ type: [CustomerAppCategoryDto] })
  categories(): Promise<CustomerAppCategoryDto[]> {
    return this.shop.categoryTree();
  }

  @Get('products')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppProductPageDto })
  async products(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: CustomerAppProductQueryDto,
  ): Promise<CustomerAppProductPageDto> {
    const page = await this.shop.productPage(ctx, query);
    return { ...page, data: page.data.map(productDto) };
  }

  @Get('products/batch')
  @CustomerRoute()
  @ApiOkResponse({ type: [CustomerAppProductDto] })
  async batch(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: CustomerAppProductBatchQueryDto,
  ): Promise<CustomerAppProductDto[]> {
    const ids = query.productIds.split(',').map((id) => Number.parseInt(id, 10));
    return (await this.shop.productsOf(ctx, ids)).map(productDto);
  }

  @Get('thumbs')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppThumbsDto })
  async thumbs(): Promise<CustomerAppThumbsDto> {
    return { urls: await this.shop.thumbs() };
  }

  @Get('barcodes/:code')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppBarcodeDto })
  async barcode(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('code') code: string,
  ): Promise<CustomerAppBarcodeDto> {
    const found = await this.shop.barcode(ctx, code.slice(0, 64));
    return { productUnitId: found.productUnitId, product: productDto(found.product) };
  }

  @Get('favourites')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppFavouritesDto })
  async favourites(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppFavouritesDto> {
    return { productIds: await this.shop.favouriteIds(ctx) };
  }

  @Put('favourites/:productId')
  @CustomerRoute()
  @HttpCode(204)
  @ApiNoContentResponse()
  async star(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.shop.star(ctx, productId);
  }

  @Delete('favourites/:productId')
  @CustomerRoute()
  @HttpCode(204)
  @ApiNoContentResponse()
  async unstar(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.shop.unstar(ctx, productId);
  }

  /** The cart priced by the server, as the office will price it again at the confirmation. */
  @Post('quote')
  @CustomerRoute()
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerAppQuoteDto })
  async quote(@Body() body: CustomerAppQuoteRequestDto): Promise<CustomerAppQuoteDto> {
    const quoted = await this.shop.quote(
      body.lines.map((line) => ({ productUnitId: line.productUnitId, qty: new Decimal(line.qty) })),
    );
    return {
      quote: toQuoteDto(quoted.quote),
      stock: quoted.stock,
      orderDeals: quoted.orderDeals.map((deal) => ({
        programId: deal.programId,
        name: deal.name,
        effect: deal.effect,
        reached: deal.reached
          ? {
              threshold: deal.reached.threshold.toFixed(0),
              value: deal.reached.value.toString(),
              missing: null,
            }
          : null,
        next: deal.next
          ? {
              threshold: deal.next.threshold.toFixed(0),
              value: deal.next.value.toString(),
              missing: deal.next.missing.toFixed(0),
            }
          : null,
      })),
    };
  }
}

/** «Захиалга» (ADR-0079 #5, #6). */
@ApiTags('customer-app')
@Controller('customer-app/orders')
export class CustomerAppOrdersController {
  constructor(private readonly orders: CustomerAppOrdersService) {}

  /** «Захиалга илгээх»: the Idempotency-Key survives a lost answer (ADR-0061 #8). */
  @Post()
  @CustomerRoute()
  @Idempotent()
  @ApiCreatedResponse({ type: CustomerAppOrderDto })
  async send(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() body: CustomerAppOrderRequestDto,
  ): Promise<CustomerAppOrderDto> {
    const order = await this.orders.send(ctx, {
      fulfilment: body.fulfilment,
      deliveryDate: body.deliveryDate,
      addressId: body.addressId ?? null,
      paymentMethod: body.paymentMethod,
      note: body.note ?? null,
      lines: body.lines.map((line) => ({
        productUnitId: line.productUnitId,
        qty: new Decimal(line.qty),
      })),
    });
    return orderDto(order, customerOrderStateOf(order.status), null, null);
  }

  @Get()
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppOrderPageDto })
  async list(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: CustomerAppOrderListQueryDto,
  ): Promise<CustomerAppOrderPageDto> {
    const page = await this.orders.page(ctx, query);
    return {
      data: page.data.map(orderRowDto),
      nextCursor: page.nextCursor,
      summary: page.summary
        ? {
            count: page.summary.count,
            confirmedTotal: whole(page.summary.confirmedTotal) ?? '0',
            pending: page.summary.pending,
          }
        : null,
    };
  }

  /** «ХТ» in the order filter: the reps who took the store's orders, by name. */
  @Get('reps')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppOrderRepsDto })
  async reps(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppOrderRepsDto> {
    return { reps: await this.orders.reps(ctx) };
  }

  @Get(':id')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppOrderDto })
  async get(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppOrderDto> {
    const { order, invoice } = await this.orders.detail(ctx, id);
    const takerName = order.channel === 'SALES_REP' ? order.createdByName : null;
    return orderDto(order, customerOrderStateOf(order.status), takerName, invoice);
  }

  /** «Дахин захиалах»: the lines for the cart; the app quotes them again today. */
  @Get(':id/reorder')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppReorderDto })
  async reorder(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppReorderDto> {
    const result = await this.orders.reorder(ctx, id);
    return {
      lines: result.lines.map((line) => ({ ...line, qty: line.qty.toString() })),
      skipped: result.skipped,
    };
  }
}

/** «Тооцоо» (ADR-0079 #7): read-only, from finance's own records. */
@ApiTags('customer-app')
@Controller('customer-app')
export class CustomerAppMoneyController {
  constructor(private readonly account: CustomerAccountService) {}

  @Get('account')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppBalanceDto })
  async get(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppBalanceDto> {
    return accountDto(await this.account.account(ctx));
  }

  @Get('invoices')
  @CustomerRoute()
  @ApiOkResponse({ type: [CustomerAppInvoiceDto] })
  async invoices(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppInvoiceDto[]> {
    return (await this.account.openInvoices(ctx)).map(invoiceDto);
  }

  @Get('invoices/:id')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppInvoiceDetailDto })
  async invoice(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppInvoiceDetailDto> {
    return invoiceDetailDto(await this.account.invoice(ctx, id));
  }

  @Get('payments')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppPaymentPageDto })
  async payments(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: PageQueryDto,
  ): Promise<CustomerAppPaymentPageDto> {
    const page = await this.account.paymentsPage(ctx, query);
    return { data: page.data.map(paymentDto), nextCursor: page.nextCursor, total: page.total };
  }

  /**
   * «Тооцооны хуулга» (ADR-0086): the opening balance, the purchases (Дебит) and the payments and
   * returns (Кредит) of the days asked for, the totals and the closing balance.
   */
  @Get('statement')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppStatementDto })
  async statement(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: CustomerAppStatementQueryDto,
  ): Promise<CustomerAppStatementDto> {
    return statementDto(await this.account.statement(ctx, query.from, query.to));
  }

  /** The bank accounts finance marks «Харилцагчид харуулах»: write the invoice number. */
  @Get('bank-accounts')
  @CustomerRoute()
  @ApiOkResponse({ type: [CustomerAppBankAccountDto] })
  bankAccounts(): Promise<CustomerAppBankAccountDto[]> {
    return this.account.bankAccounts();
  }
}

/** The bell and the popup (ADR-0079 #8). */
@ApiTags('customer-app')
@Controller('customer-app/notifications')
export class CustomerAppNotificationsController {
  constructor(private readonly inbox: CustomerInboxService) {}

  @Get('summary')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppNotificationSummaryDto })
  async summary(
    @CurrentCustomer() ctx: CustomerContext,
  ): Promise<CustomerAppNotificationSummaryDto> {
    const summary = await this.inbox.summary(ctx);
    return { unread: summary.unread, notices: summary.notices.map(noticeDto) };
  }

  @Get()
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppNotificationPageDto })
  async list(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: PageQueryDto,
  ): Promise<CustomerAppNotificationPageDto> {
    const page = await this.inbox.list(ctx, query);
    return { data: page.data.map(notificationDto), nextCursor: page.nextCursor };
  }

  @Post('read')
  @CustomerRoute()
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerAppReadResultDto })
  read(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() body: CustomerAppReadRequestDto,
  ): Promise<CustomerAppReadResultDto> {
    return this.inbox.read(ctx, body);
  }
}
