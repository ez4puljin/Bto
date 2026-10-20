import type { CustomerNotificationKind } from '@tugeel/shared/notifications';
import { colors } from '../theme/tokens';

// The store's notifications (ADR-0079 #8, the Notifications board): a coloured tile per kind, and
// the screen a tap opens. The texts are mn.json's `notifications.customerKinds.*` and the payload.

export type StoreTile = 'check' | 'cross' | 'clock' | 'money' | 'receipt';

export const STORE_TILES: Record<CustomerNotificationKind, { tile: StoreTile; color: string }> = {
  ORDER_CONFIRMED: { tile: 'check', color: colors.tint.green },
  ORDER_CANCELLED: { tile: 'cross', color: colors.destructive },
  ORDER_SOLD: { tile: 'receipt', color: colors.tint.blue },
  PAYMENT_RECORDED: { tile: 'money', color: colors.success },
  INVOICE_DUE_SOON: { tile: 'clock', color: colors.tint.orange },
  INVOICE_OVERDUE: { tile: 'clock', color: colors.tint.orange },
};

/**
 * «Мэдэгдэл»'s two tabs (ADR-0092 #8): «Захиалга» holds the store's own notifications (orders,
 * payments, invoices), «Урамшуулал» the admin's notices. Each tab counts its unread; the screen
 * opens on the first tab with something unread, «Захиалга» first.
 */
export type NoticeTab = 'orders' | 'promos';

export function noticeTabsOf(
  notices: readonly { read: boolean }[],
  notifications: readonly { read: boolean }[],
): { orders: number; promos: number; first: NoticeTab } {
  const orders = notifications.filter((notification) => !notification.read).length;
  const promos = notices.filter((notice) => !notice.read).length;
  return { orders, promos, first: orders === 0 && promos > 0 ? 'promos' : 'orders' };
}

/** Where a tap goes: the order, the invoice, «Тооцоо», or nowhere when its record is gone. */
export function storeTargetOf(notification: {
  kind: CustomerNotificationKind;
  orderId: number | null;
  invoiceId: number | null;
}): string | null {
  switch (notification.kind) {
    case 'ORDER_CONFIRMED':
    case 'ORDER_CANCELLED':
    case 'ORDER_SOLD':
      return notification.orderId !== null ? `/order/${notification.orderId}` : null;
    case 'PAYMENT_RECORDED':
      return '/account';
    case 'INVOICE_DUE_SOON':
    case 'INVOICE_OVERDUE':
      return notification.invoiceId !== null ? `/invoice/${notification.invoiceId}` : '/account';
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' ? value : 0);

/**
 * The facts of a notification's line under its title, read defensively from the payload (an older
 * row may lack a field): the numbers, amounts and dates the screen words.
 */
export interface StoreNotificationFacts {
  orderNumber: string | null;
  amount: string | null;
  backorderedLines: number;
  reason: string | null;
  invoiceNumber: string | null;
  paymentNumber: string | null;
  dueDate: string | null;
  /** A payment's settled invoices' numbers. */
  invoices: string[];
}

export function storeFactsOf(
  kind: CustomerNotificationKind,
  payload: Record<string, unknown>,
): StoreNotificationFacts {
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices.flatMap((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { number?: unknown }).number === 'string'
          ? [(entry as { number: string }).number]
          : [],
      )
    : [];
  const amount =
    kind === 'ORDER_SOLD'
      ? (text(payload.invoiceTotal) ?? text(payload.orderTotal))
      : kind === 'PAYMENT_RECORDED'
        ? text(payload.amount)
        : kind === 'INVOICE_DUE_SOON' || kind === 'INVOICE_OVERDUE'
          ? text(payload.openAmount)
          : text(payload.orderTotal);
  return {
    orderNumber: text(payload.orderNumber),
    amount,
    backorderedLines: count(payload.backorderedLines),
    reason: text(payload.reason),
    invoiceNumber: text(payload.invoiceNumber),
    paymentNumber: text(payload.paymentNumber),
    dueDate: text(payload.dueDate),
    invoices,
  };
}
