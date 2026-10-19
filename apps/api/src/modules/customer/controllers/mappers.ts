import type { Decimal } from '@tugeel/shared/money';
import type { CustomerPayment, CustomerStatement } from '../../finance';
import type { CustomerNotice, CustomerNotification } from '../../notifications';
import type { CustomerOrderDetail, CustomerOrderRow } from '../../sales';
import type {
  CustomerAppInvoiceDetailDto,
  CustomerAppInvoiceDto,
  CustomerAppNoticeDto,
  CustomerAppNotificationDto,
  CustomerAppOrderDto,
  CustomerAppOrderRowDto,
  CustomerAppPaymentDto,
  CustomerAppProductDto,
  CustomerAppStatementDto,
} from '../dto/customer-app.dto';
import type {
  CustomerAccount,
  CustomerInvoice,
  CustomerInvoiceDetail,
} from '../services/customer-account.service';
import type { CustomerProduct } from '../services/customer-shop.service';

/** Prices and orders in whole MNT, finance in two decimals (as the staff routes serialise them). */
export const whole = (value: Decimal | null): string | null => value?.toFixed(0) ?? null;
export const cents = (value: Decimal): string => value.toFixed(2);
const centsOrNull = (value: Decimal | null): string | null => value?.toFixed(2) ?? null;
const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function productDto(product: CustomerProduct): CustomerAppProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    thumbUrl: product.thumbUrl,
    images: product.images,
    isNew: product.isNew,
    stock: product.stock,
    favourite: product.favourite,
    basePrice: whole(product.basePrice),
    units: product.units.map((unit) => ({
      id: unit.id,
      uomName: unit.uomName,
      uomCode: unit.uomCode,
      factorToBase: unit.factorToBase.toString(),
      isBase: unit.isBase,
      isDefaultSales: unit.isDefaultSales,
      barcodes: unit.barcodes,
      wholesale: whole(unit.wholesale),
      basis: unit.basis,
    })),
  };
}

export function orderRowDto(row: CustomerOrderRow): CustomerAppOrderRowDto {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    state: row.state,
    channel: row.channel,
    takerName: row.takerName,
    createdAt: row.createdAt.toISOString(),
    createdDate: row.createdDate,
    createdTime: row.createdTime,
    fulfilment: row.fulfilment,
    deliveryDate: row.deliveryDate,
    paymentMethod: row.paymentMethod,
    total: whole(row.total),
    estimatedTotal: whole(row.estimatedTotal),
    lineCount: row.lineCount,
    backorderedLines: row.backorderedLines,
    cancelReason: row.cancelReason,
  };
}

export function orderDto(
  order: CustomerOrderDetail,
  state: CustomerAppOrderDto['state'],
  takerName: string | null,
  invoice: { id: number; number: string } | null,
): CustomerAppOrderDto {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    state,
    channel: order.channel,
    takerName,
    createdAt: order.createdAt.toISOString(),
    fulfilment: order.fulfilment,
    deliveryDate: order.deliveryDate,
    paymentMethod: order.paymentMethod,
    total: whole(order.total),
    estimatedTotal: whole(order.estimatedTotal),
    cancelReason: order.cancelReason,
    addressText: order.addressText,
    note: order.note,
    confirmedAt: iso(order.confirmedAt),
    pickedAt: iso(order.pickedAt),
    deliveredAt: iso(order.deliveredAt),
    cancelledAt: iso(order.cancelledAt),
    invoice,
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      qty: line.qty.toString(),
      baseUnitName: line.baseUnitName,
      qtyBase: line.qtyBase.toString(),
      qtyBackordered: line.qtyBackordered.toString(),
      total: whole(line.total),
      estimatedTotal: whole(line.estimatedTotal),
    })),
  };
}

export function accountDto(account: CustomerAccount) {
  return {
    balance: cents(account.balance),
    overdueAmount: cents(account.overdueAmount),
    oldestOverdueDate: account.oldestOverdueDate,
    creditLimit: centsOrNull(account.creditLimit),
    creditAvailable: centsOrNull(account.creditAvailable),
    creditHold: account.creditHold,
    paymentTermDays: account.paymentTermDays,
    openInvoices: account.openInvoices,
    payments: account.payments,
  };
}

export function statementDto(statement: CustomerStatement): CustomerAppStatementDto {
  return {
    from: statement.from,
    to: statement.to,
    opening: cents(statement.opening),
    entries: statement.entries.map((entry) => ({
      id: entry.id,
      date: entry.entryDate,
      kind: entry.kind,
      number: entry.docNumber,
      invoiceId: entry.docType === 'INVOICE' ? entry.docId : null,
      debit: cents(entry.debit),
      credit: cents(entry.credit),
      balance: cents(entry.balance),
    })),
    totalDebit: cents(statement.totalDebit),
    totalCredit: cents(statement.totalCredit),
    closing: cents(statement.closing),
  };
}

export function invoiceDto(invoice: CustomerInvoice): CustomerAppInvoiceDto {
  return {
    id: invoice.id,
    number: invoice.number,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    orderNumber: invoice.orderNumber,
    total: cents(invoice.total),
    openAmount: cents(invoice.openAmount),
    daysOverdue: invoice.daysOverdue,
    daysLeft: invoice.daysLeft,
  };
}

export function invoiceDetailDto(invoice: CustomerInvoiceDetail): CustomerAppInvoiceDetailDto {
  return {
    ...invoiceDto(invoice),
    status: invoice.status,
    orderId: invoice.orderId,
    subtotal: cents(invoice.subtotal),
    discountTotal: cents(invoice.discountTotal),
    vatTotal: cents(invoice.vatTotal),
    cityTaxTotal: cents(invoice.cityTaxTotal),
    paidAmount: cents(invoice.paidAmount),
    creditedAmount: cents(invoice.creditedAmount),
    lines: invoice.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      uomName: line.uomName,
      qty: line.qty.toString(),
      unitPrice: cents(line.unitPrice),
      subtotal: cents(line.subtotal),
      discountAmount: cents(line.discountAmount),
      total: cents(line.total),
      vatAmount: cents(line.vatAmount),
    })),
  };
}

export function paymentDto(payment: CustomerPayment): CustomerAppPaymentDto {
  return {
    id: payment.id,
    number: payment.number,
    kind: payment.kind,
    method: payment.method,
    amount: cents(payment.amount),
    paidOn: payment.paidOn,
    invoices: payment.invoices.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      number: invoice.number,
      amount: cents(invoice.amount),
    })),
  };
}

export function noticeDto(notice: CustomerNotice): CustomerAppNoticeDto {
  return { ...notice, createdAt: notice.createdAt.toISOString() };
}

export function notificationDto(row: CustomerNotification): CustomerAppNotificationDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
