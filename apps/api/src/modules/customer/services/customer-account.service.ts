import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { OrderChannel } from '@tugeel/shared/sales';
import { addDays, businessDate } from '@tugeel/shared/time';
import { invalid } from '../../../common/errors/app-error';
import {
  ArLedgerService,
  type CustomerStatement,
  type CustomerBankAccount,
  type CustomerPayment,
  type InvoiceDetail,
  InvoiceQueryService,
  type InvoiceSummary,
  MoneyAccountsService,
  PaymentsService,
} from '../../finance';
import { type CustomerContext, OrgService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  type CustomerOrderOrigin,
  CustomerOrdersService,
  SalesPipelinesService,
} from '../../sales';

const ZERO = new Decimal(0);

/** The longest statement a store may ask for (a year). */
export const STATEMENT_MAX_DAYS = 366;
const DAY_MS = 86_400_000;

/** «Тооцоо» (ADR-0079 #7): the store's balance and credit, never the hold's internal reason. */
export interface CustomerAccount {
  /** Σ invoices − Σ payments; negative = an advance. */
  balance: Decimal;
  overdueAmount: Decimal;
  /** The oldest due date among the overdue invoices; null when nothing is overdue. */
  oldestOverdueDate: string | null;
  /** Set only when the store has a limit (nothing about limits otherwise). */
  creditLimit: Decimal | null;
  /** The limit less the balance and the confirmed orders not yet invoiced, never below 0. */
  creditAvailable: Decimal | null;
  /** «Зээл хаалттай». */
  creditHold: boolean;
  paymentTermDays: number | null;
  openInvoices: number;
  payments: number;
}

/** A statement whose purchases say which order, and who took it, they came from. */
export interface StoreStatement extends Omit<CustomerStatement, 'entries'> {
  entries: (CustomerStatement['entries'][number] & { order: CustomerOrderOrigin | null })[];
}

/** The checkout's warning (ADR-0079 #5): the store may still send. */
export interface CreditCheck {
  warnings: ('HOLD' | 'OVERDUE' | 'LIMIT')[];
  overdueAmount: Decimal;
  oldestOverdueDate: string | null;
  creditLimit: Decimal | null;
  creditAvailable: Decimal | null;
  /** How far this cart takes the store past its limit; 0 when it does not. */
  excess: Decimal;
}

/** An open invoice in the store's list: oldest due first, with the days past or left. */
export interface CustomerInvoice {
  id: number;
  number: string;
  invoiceDate: string;
  dueDate: string;
  orderNumber: string | null;
  total: Decimal;
  openAmount: Decimal;
  /** > 0 when overdue (days past the due date), else 0. */
  daysOverdue: number;
  /** Days until the due date when not overdue (0 on the day), else 0. */
  daysLeft: number;
}

export interface CustomerInvoiceDetail extends CustomerInvoice {
  status: 'ISSUED' | 'VOID';
  orderId: number | null;
  /** Who took the invoice's order: the app, the office, a rep (`orderTakerName`). */
  orderChannel: OrderChannel | null;
  orderTakerName: string | null;
  subtotal: Decimal;
  discountTotal: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
  /** What payments settled of it (credit notes are counted apart). */
  paidAmount: Decimal;
  creditedAmount: Decimal;
  lines: {
    productId: number;
    sku: string;
    name: string;
    uomName: string;
    qty: Decimal;
    unitPrice: Decimal;
    subtotal: Decimal;
    discountAmount: Decimal;
    total: Decimal;
    vatAmount: Decimal;
  }[];
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function toCustomerInvoice(invoice: InvoiceSummary, today: string): CustomerInvoice {
  const overdue =
    invoice.status === 'ISSUED' && invoice.openAmount.gt(0) && invoice.dueDate < today;
  return {
    id: invoice.id,
    number: invoice.number,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    orderNumber: invoice.orderNumber,
    total: invoice.total,
    openAmount: invoice.openAmount,
    daysOverdue: overdue ? daysBetween(invoice.dueDate, today) : 0,
    daysLeft: overdue ? 0 : Math.max(0, daysBetween(today, invoice.dueDate)),
  };
}

/**
 * The store's account from finance's own records, read-only (ADR-0079 #7): the cached balance,
 * the overdue amount read live, the limit and what remains of it, the open invoices, an invoice of
 * its own, its payments and the bank accounts finance shows customers. Payments are recorded only
 * by the accountant (SPEC §6.12 #1).
 */
@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly ledger: ArLedgerService,
    private readonly invoices: InvoiceQueryService,
    private readonly payments: PaymentsService,
    private readonly moneyAccounts: MoneyAccountsService,
    private readonly customers: CustomersService,
    private readonly orders: CustomerOrdersService,
    private readonly pipelines: SalesPipelinesService,
    private readonly org: OrgService,
  ) {}

  async account(ctx: CustomerContext): Promise<CustomerAccount> {
    const credit = await this.credit(ctx.customerId);
    const payments = await this.payments.ofCustomer(ctx.customerId, { limit: 1 });
    return {
      balance: credit.balance,
      overdueAmount: credit.overdueAmount,
      oldestOverdueDate: credit.oldestOverdueDate,
      creditLimit: credit.creditLimit,
      creditAvailable: credit.creditAvailable,
      creditHold: credit.creditHold,
      paymentTermDays: credit.paymentTermDays,
      openInvoices: credit.openInvoices,
      payments: payments.total ?? 0,
    };
  }

  /** The cart's warning: hold, overdue, or `amount` taking the store past its limit. */
  async creditCheck(ctx: CustomerContext, amount: Decimal): Promise<CreditCheck> {
    const credit = await this.credit(ctx.customerId);
    const excess =
      credit.creditLimit === null
        ? ZERO
        : Decimal.max(ZERO, credit.exposure.plus(amount).minus(credit.creditLimit));
    return {
      warnings: [
        ...(credit.creditHold ? (['HOLD'] as const) : []),
        ...(credit.overdueAmount.gt(0) ? (['OVERDUE'] as const) : []),
        ...(excess.gt(0) ? (['LIMIT'] as const) : []),
      ],
      overdueAmount: credit.overdueAmount,
      oldestOverdueDate: credit.oldestOverdueDate,
      creditLimit: credit.creditLimit,
      creditAvailable: credit.creditAvailable,
      excess,
    };
  }

  async openInvoices(ctx: CustomerContext): Promise<CustomerInvoice[]> {
    const today = businessDate();
    return (await this.invoices.openOf(ctx.customerId)).map((invoice) =>
      toCustomerInvoice(invoice, today),
    );
  }

  /** One invoice of the store; 404 for another store's, as for one that does not exist. */
  async invoice(ctx: CustomerContext, id: number): Promise<CustomerInvoiceDetail> {
    const detail: InvoiceDetail = await this.invoices.ofCustomer(ctx.customerId, id);
    const origin =
      detail.orderId === null
        ? null
        : ((await this.orders.origins(ctx.customerId, [detail.orderId])).get(detail.orderId) ??
          null);
    const live = detail.allocations.filter((allocation) => allocation.voidedAt === null);
    const sum = (source: 'PAYMENT' | 'CREDIT_NOTE') =>
      live
        .filter((allocation) => allocation.sourceType === source)
        .reduce((total, allocation) => total.plus(allocation.amount), ZERO);
    return {
      ...toCustomerInvoice(detail, businessDate()),
      status: detail.status,
      orderId: detail.orderId,
      orderChannel: origin?.channel ?? null,
      orderTakerName: origin?.takerName ?? null,
      subtotal: detail.subtotal,
      discountTotal: detail.discountTotal,
      vatTotal: detail.vatTotal,
      cityTaxTotal: detail.cityTaxTotal,
      paidAmount: sum('PAYMENT'),
      creditedAmount: sum('CREDIT_NOTE'),
      lines: detail.lines.map((line) => ({
        productId: line.productId,
        sku: line.productSku,
        name: line.productName,
        uomName: line.uomName,
        qty: line.qty,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        discountAmount: line.discountAmount,
        total: line.total,
        vatAmount: line.vatAmount,
      })),
    };
  }

  /**
   * The store's statement (ADR-0086): «Эхний үлдэгдэл», the purchases (Дебит) and the payments
   * and returns (Кредит) of `from` … `to`, «Эцсийн үлдэгдэл»; at most 366 days, never past today.
   */
  async statement(ctx: CustomerContext, from: string, to: string): Promise<StoreStatement> {
    const today = businessDate();
    if (to > today) throw invalid('to', 'notFuture', 'today at the latest');
    if (from > to) throw invalid('from', 'beforeTo', 'on or before to');
    if (addDays(from, STATEMENT_MAX_DAYS - 1) < to) {
      throw invalid('from', 'maxDays', `at most ${STATEMENT_MAX_DAYS} days`);
    }
    const statement = await this.ledger.statement(ctx.customerId, from, to);
    // Who took each purchase's order: the app, the office, or a rep by name (the owner 2026-10-20).
    const origins = await this.orders.origins(
      ctx.customerId,
      statement.entries.flatMap((entry) => (entry.orderId === null ? [] : [entry.orderId])),
    );
    return {
      ...statement,
      entries: statement.entries.map((entry) => ({
        ...entry,
        order: entry.orderId === null ? null : (origins.get(entry.orderId) ?? null),
      })),
    };
  }

  paymentsPage(
    ctx: CustomerContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: CustomerPayment[]; nextCursor: string | null; total: number | null }> {
    return this.payments.ofCustomer(ctx.customerId, query);
  }

  bankAccounts(): Promise<CustomerBankAccount[]> {
    return this.moneyAccounts.shownToCustomers();
  }

  /** «Профайл» and the checkout's header: the store, its centre and whether orders are taken. */
  async me(ctx: CustomerContext) {
    const customer = await this.customers.get(ctx.customerId);
    const terms = await this.customers.creditTerms(ctx.customerId);
    const address =
      customer.addresses.find((own) => own.isDefault && own.archivedAt === null) ?? null;
    return {
      customerId: customer.id,
      code: customer.code,
      name: customer.name,
      phone: ctx.phone,
      centre: await this.centre(),
      defaultAddress: address
        ? { id: address.id, label: address.label, address: address.address }
        : null,
      paymentTermDays: terms.paymentTerm.days,
      ordersOpen: await this.pipelines.customerAppOpen(),
      today: businessDate(),
    };
  }

  /** The checkout's choices (ADR-0079 #5): the live addresses, the default first, and pickup. */
  async checkout(ctx: CustomerContext) {
    const customer = await this.customers.get(ctx.customerId);
    const addresses = customer.addresses
      .filter((own) => own.archivedAt === null)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.id - b.id)
      .map((own) => ({
        id: own.id,
        label: own.label,
        address: own.address,
        isDefault: own.isDefault,
      }));
    const today = businessDate();
    return {
      today,
      addresses,
      pickup: await this.centre(),
      ordersOpen: await this.pipelines.customerAppOpen(),
    };
  }

  /**
   * The centre the store orders from (one today, ADR-0079 #4): the branch of the active wholesale
   * warehouses and their names.
   */
  private async centre(): Promise<{ branchName: string; warehouses: string[] } | null> {
    const warehouses = (await this.org.listWarehouses({ kind: 'WHOLESALE' })).filter(
      (warehouse) => warehouse.status === 'ACTIVE' && warehouse.branchId !== null,
    );
    const first = warehouses[0];
    if (!first || first.branchId === null) return null;
    const branch = await this.org.getBranch(first.branchId);
    return {
      branchName: branch.name,
      warehouses: warehouses
        .filter((warehouse) => warehouse.branchId === first.branchId)
        .map((warehouse) => warehouse.name),
    };
  }

  private async credit(customerId: number) {
    const terms = await this.customers.creditTerms(customerId);
    const balance = await this.ledger.balanceOf(customerId);
    const overdue = await this.ledger.overdueOf(customerId);
    const exposure = balance.balance.plus(await this.orders.openExposureOf(customerId));
    const limit = terms.creditLimit;
    return {
      balance: balance.balance,
      openInvoices: balance.openInvoices,
      overdueAmount: overdue.amount,
      oldestOverdueDate: overdue.oldestDueDate,
      creditLimit: limit,
      creditAvailable: limit === null ? null : Decimal.max(ZERO, limit.minus(exposure)),
      creditHold: terms.creditHold,
      paymentTermDays: terms.paymentTerm.days,
      exposure,
    };
  }
}
