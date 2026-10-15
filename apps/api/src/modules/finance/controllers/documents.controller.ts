import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  CreditNoteDetailDto,
  CreditNoteListQueryDto,
  CreditNotePageDto,
  CreditNoteRequestDto,
  InvoiceDetailDto,
  InvoiceListQueryDto,
  InvoicePageDto,
  PaymentDetailDto,
  PaymentListQueryDto,
  PaymentPageDto,
  PaymentRequestDto,
  VoidRequestDto,
} from '../dto/finance.dto';
import { CreditNotesService } from '../services/credit-notes.service';
import { InvoiceQueryService } from '../services/invoice-query.service';
import { InvoicingService } from '../services/invoicing.service';
import { PaymentsService } from '../services/payments.service';
import {
  creditNoteDetailDto,
  creditNoteDto,
  invoiceDetailDto,
  invoiceDto,
  paymentDetailDto,
  paymentDto,
} from './mappers';

const READ = 'finance.read';
const INVOICES = 'finance.invoices.manage';
const PAYMENTS = 'finance.payments.record';

/** Invoices (ADR-0060 #3): issued by the sale, read here, voided by the accountant. */
@ApiTags('finance')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly query: InvoiceQueryService,
    private readonly invoicing: InvoicingService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: InvoicePageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: InvoiceListQueryDto,
  ): Promise<InvoicePageDto> {
    const page = await this.query.list(ctx, query);
    return { data: page.data.map(invoiceDto), nextCursor: page.nextCursor, total: page.total };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: InvoiceDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<InvoiceDetailDto> {
    return invoiceDetailDto(await this.query.get(id));
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission(INVOICES)
  @Idempotent()
  @ApiOkResponse({ type: InvoiceDetailDto })
  async void(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VoidRequestDto,
  ): Promise<InvoiceDetailDto> {
    return invoiceDetailDto(await this.invoicing.void(ctx, id, body.reason));
  }
}

/** Credit notes (ADR-0060 #6): goods back, the receivable reduced. */
@ApiTags('finance')
@Controller('credit-notes')
export class CreditNotesController {
  constructor(private readonly notes: CreditNotesService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: CreditNotePageDto })
  async list(@Query() query: CreditNoteListQueryDto): Promise<CreditNotePageDto> {
    const page = await this.notes.list(query);
    return { data: page.data.map(creditNoteDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CreditNoteDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<CreditNoteDetailDto> {
    return creditNoteDetailDto(await this.notes.get(id));
  }

  @Post()
  @RequirePermission(INVOICES)
  @Idempotent()
  @ApiCreatedResponse({ type: CreditNoteDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreditNoteRequestDto,
  ): Promise<CreditNoteDetailDto> {
    return creditNoteDetailDto(
      await this.notes.create(ctx, {
        invoiceId: body.invoiceId,
        reason: body.reason,
        noteDate: body.noteDate ?? null,
        warehouseId: body.warehouseId ?? null,
        binId: body.binId ?? null,
        lines: body.lines.map((line) => ({
          invoiceLineId: line.invoiceLineId,
          qty: new Decimal(line.qty),
        })),
      }),
    );
  }
}

/** The vouchers of the cash and bank books (ADR-0060 #5). */
@ApiTags('finance')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: PaymentPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PaymentListQueryDto,
  ): Promise<PaymentPageDto> {
    const page = await this.payments.list(ctx, query);
    return { data: page.data.map(paymentDto), nextCursor: page.nextCursor, total: page.total };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PaymentDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<PaymentDetailDto> {
    return paymentDetailDto(await this.payments.get(id));
  }

  @Post()
  @RequirePermission(PAYMENTS)
  @Idempotent()
  @ApiCreatedResponse({ type: PaymentDetailDto })
  async record(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PaymentRequestDto,
  ): Promise<PaymentDetailDto> {
    return paymentDetailDto(
      await this.payments.record(ctx, {
        kind: body.kind,
        moneyAccountId: body.moneyAccountId,
        customerId: body.customerId ?? null,
        glAccountId: body.glAccountId ?? null,
        amount: new Decimal(body.amount),
        paidOn: body.paidOn,
        description: body.description ?? null,
        reference: body.reference ?? null,
        counterpartyName: body.counterpartyName ?? null,
        collectedBy: body.collectedBy ?? null,
        allocations: body.allocations?.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amount: new Decimal(allocation.amount),
        })),
      }),
    );
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission(PAYMENTS)
  @Idempotent()
  @ApiOkResponse({ type: PaymentDetailDto })
  async void(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VoidRequestDto,
  ): Promise<PaymentDetailDto> {
    return paymentDetailDto(await this.payments.void(ctx, id, body.reason));
  }
}
