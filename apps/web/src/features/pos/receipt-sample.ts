import type { EdgePrintSecrets, EdgeReceipt, ReceiptTemplateKind } from '@tugeel/shared/pos';

/** What the editor's preview shows besides a plain receipt (ADR-0141). */
export interface SampleOptions {
  /** A test receipt (the fake e-Barimt) instead of a real one. */
  test: boolean;
  /** Sold to a company with its TIN (B2B). */
  company: boolean;
  /** A credit slip (ADR-0109): no VAT, QR or lottery. */
  credit: boolean;
  /** A bonus card member. */
  member: boolean;
}

/** A made-up receipt for the template editor's preview; never sent anywhere. */
export function sampleReceipt(
  kind: ReceiptTemplateKind,
  options: SampleOptions,
  footer: string | null,
  title: string | null,
): EdgeReceipt {
  const refund = kind === 'RETURN';
  return {
    clientId: 'sample',
    kind,
    refundsNumber: refund ? 'К1-261104-0012' : null,
    number: refund ? 'К1-261104-Б0003' : 'К1-261104-0042',
    soldAt: new Date().toISOString(),
    tillCode: 'К1',
    cashierName: 'Кассчин Болд',
    companyName: 'Бүтэн-Оргил ХХК',
    lines: refund
      ? [{ name: 'Сүү 1л', uomName: 'ш', qty: '2', unitPrice: '3500.00', total: '7000.00' }]
      : [
          { name: 'Сүү 1л', uomName: 'ш', qty: '2', unitPrice: '3500.00', total: '7000.00' },
          { name: 'Талх цагаан', uomName: 'ш', qty: '1', unitPrice: '2800.00', total: '2800.00' },
          {
            name: 'Ус ундаа 0.5л (12 ширхэгтэй хайрцаг)',
            uomName: 'хайрцаг',
            qty: '1',
            unitPrice: '14400.00',
            total: '13900.00',
          },
        ],
    subtotal: refund ? '7000.00' : '24200.00',
    discountTotal: refund ? '0.00' : '500.00',
    total: refund ? '7000.00' : '23700.00',
    vatTotal: refund ? '636.36' : '2154.55',
    tenders: options.credit
      ? [{ kind: 'CREDIT', amount: refund ? '7000.00' : '23700.00', tendered: null }]
      : refund
        ? [{ kind: 'CASH', amount: '7000.00', tendered: null }]
        : [
            { kind: 'CARD', amount: '13700.00', tendered: null },
            { kind: 'CASH', amount: '10000.00', tendered: '20000.00' },
          ],
    change: refund || options.credit ? '0.00' : '10000.00',
    loyalty: options.member
      ? {
          memberName: 'Сарантуяа',
          phone: '99112233',
          tierName: 'Мөнгөн',
          percent: '2',
          earned: refund ? '0' : '474',
          spent: '0',
          givenBack: '0',
          clawback: refund ? '140' : '0',
          balance: '5320',
        }
      : null,
    credit: options.credit
      ? {
          customerId: 1,
          customerCode: 'Х00123',
          customerName: 'Номин дэлгүүр',
          amount: refund ? '7000.00' : '23700.00',
        }
      : null,
    title,
    footer,
    ebarimt: {
      mode: options.test ? 'TEST' : 'REAL',
      ddtd: '000000000000000000000000000000000012345678',
      status: 'CONFIRMED',
      receiptType: options.company ? 'B2B' : 'B2C',
      customerTin: options.company ? '5317878' : null,
      customerName: options.company ? 'Номин дэлгүүр ХХК' : null,
      merchantTin: '6014321',
      merchantName: 'Бүтэн-Оргил ХХК',
      inactiveId: refund ? '000000000000000000000000000000000012340001' : null,
    },
  };
}

/** A made-up lottery and QR so the e-Barimt part shows its full size. */
export const SAMPLE_SECRETS: EdgePrintSecrets = {
  lottery: 'ЖИ 00000000',
  qrData: 'BTO-RECEIPT-TEMPLATE-PREVIEW',
};
