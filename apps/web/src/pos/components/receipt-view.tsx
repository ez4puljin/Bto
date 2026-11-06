import { Decimal } from '@tugeel/shared/money';
import {
  defaultReceiptLayout,
  type EdgePrintSecrets,
  type EdgeReceipt,
  fillReceiptText,
  posReceiptBarcode,
  type ReceiptAlign,
  type ReceiptBlock,
  receiptBlockShown,
  type ReceiptFacts,
  type ReceiptLayout,
  type ReceiptSize,
  type ReceiptTextVariable,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { cn } from 'cn';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Code128Svg } from '@/lib/barcode/code128-svg';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty, formatTugrik } from '@/lib/money';
import { QrCode } from './qr-code';

const ALIGN: Record<ReceiptAlign, string> = {
  LEFT: 'text-left',
  CENTER: 'text-center',
  RIGHT: 'text-right',
};
/** The receipt's base text, on the paper and on the screen. */
const BASE_PAPER: Record<ReceiptSize, string> = {
  SM: 'text-[0.625rem]',
  MD: 'text-[0.6875rem]',
  LG: 'text-[0.75rem]',
};
const BASE_SCREEN: Record<ReceiptSize, string> = {
  SM: 'text-[0.75rem]',
  MD: 'text-[0.8125rem]',
  LG: 'text-[0.875rem]',
};
/** A text block's size against the base. */
const TEXT_SIZE: Record<ReceiptSize, string> = {
  SM: 'text-[0.9em]',
  MD: 'text-[1em]',
  LG: 'text-[1.3em]',
};
const SPACE: Record<ReceiptSize, string> = { SM: 'h-1.5', MD: 'h-3', LG: 'h-6' };
/** The store's own QR code: about 20, 28 or 36 mm on the paper. */
const QR_SIZE: Record<ReceiptSize, string> = {
  SM: 'size-24 print:size-[20mm]',
  MD: 'size-32 print:size-[28mm]',
  LG: 'size-40 print:size-[36mm]',
};
const SELF: Record<ReceiptAlign, string> = { LEFT: 'mr-auto', CENTER: 'mx-auto', RIGHT: 'ml-auto' };

interface Facts {
  receipt: EdgeReceipt;
  print: EdgePrintSecrets | null;
  copy: boolean;
  copyLabel: string | undefined;
  credit: NonNullable<EdgeReceipt['credit']> | null;
  refund: boolean;
  real: boolean;
  waiting: boolean;
  /** What decides the free blocks (ADR-0142). */
  shown: ReceiptFacts;
  /** The values `{{number}}` and the others print. */
  values: Partial<Record<ReceiptTextVariable, string | null>>;
  /** The POS's id, for the receipt's barcode; null: no barcode. */
  tillId: number | null;
}

/**
 * The receipt, on screen and on the paper (ADR-0065), drawn from its template's blocks (ADR-0141):
 * the heading with the seller and its TIN and the banners (a copy, a credit slip, a test receipt, a
 * return), the receipt's facts, the lines, the totals with VAT, the tenders and the change, the
 * bonus card, the e-Barimt part with the lottery and the QR code while the edge still holds them,
 * a credit slip's signature, the closing line, and the admin's texts, rules and spaces between.
 * ADR-0109: a sale with credit prints as a credit slip — the customer, the part on credit, no VAT,
 * QR or lottery (no e-Barimt). With no template the receipt prints as it did before them.
 */
export function ReceiptView({
  receipt,
  print = null,
  copy = false,
  paper = false,
  label,
  copyLabel,
  layout = null,
  tillId = null,
}: {
  receipt: EdgeReceipt;
  /** The lottery and the QR data: only in memory, only to draw this receipt. */
  print?: EdgePrintSecrets | null;
  copy?: boolean;
  /** The printed sheet: no frame, the printer's width. */
  paper?: boolean;
  label?: string;
  /** Which of a credit slip's two copies this is. */
  copyLabel?: string;
  /** The POS's template for this kind of receipt; null: the built-in layout. */
  layout?: ReceiptLayout | null;
  /** ADR-0142: the POS's id, for the receipt's barcode. */
  tillId?: number | null;
}) {
  const { t } = useTranslation();
  const used = layout ?? defaultReceiptLayout();
  const facts = receipt.ebarimt;
  const credit = receipt.credit ?? null;
  const real = facts.mode === 'REAL' && credit === null;
  const info: Facts = {
    receipt,
    print,
    copy,
    copyLabel,
    credit,
    refund: receipt.kind === 'RETURN',
    real,
    waiting: real && (facts.status === 'PENDING' || facts.status === undefined),
    shown: {
      credit: credit !== null,
      member: Boolean(receipt.loyalty),
      b2b: facts.receiptType === 'B2B',
      day: businessDate(new Date(receipt.soldAt)),
    },
    values: {
      number: receipt.number,
      date: formatUbDateTime(Date.parse(receipt.soldAt)).slice(0, 10),
      time: formatUbDateTime(Date.parse(receipt.soldAt)).slice(11, 16),
      till: receipt.tillCode,
      cashier: receipt.cashierName,
      total: formatTugrik(receipt.total),
      customer: credit?.customerName ?? facts.customerName ?? null,
      member: receipt.loyalty?.memberName ?? null,
      points: receipt.loyalty ? formatMnt(receipt.loyalty.balance) : null,
      store: receipt.title ?? facts.merchantName ?? receipt.companyName ?? null,
    },
    tillId,
  };
  return (
    <article
      aria-label={label ?? t('posKiosk.receipt.label', { number: receipt.number })}
      className={cn(
        'bg-background font-mono leading-relaxed text-foreground',
        paper
          ? cn('w-full px-1 py-2', BASE_PAPER[used.size])
          : cn(
              'mx-auto w-full rounded-xl border border-dashed border-input px-5 py-4',
              used.paper === 'MM58' ? 'max-w-[17rem]' : 'max-w-sm',
              BASE_SCREEN[used.size],
            ),
      )}
    >
      {used.blocks
        .filter((block) => receiptBlockShown(block, info.shown))
        .map((block, index) => (
          <BlockView key={index} block={block} info={info} />
        ))}
    </article>
  );
}

function BlockView({ block, info }: { block: ReceiptBlock; info: Facts }) {
  const { t } = useTranslation();
  const { receipt, credit } = info;
  switch (block.type) {
    case 'HEADING':
      return <Heading block={block} info={info} />;
    case 'DOC_INFO':
      return <DocInfo showTill={block.showTill} showCashier={block.showCashier} info={info} />;
    case 'LINES':
      return (
        <ul className="space-y-1.5 py-1.5">
          {receipt.lines.map((line, index) => (
            <li key={index}>
              {block.compact ? (
                <p className="flex justify-between gap-3">
                  <span className="min-w-0 font-sans font-medium">
                    {line.name}
                    <span className="block font-mono font-normal text-muted-foreground">
                      {t('posKiosk.receipt.lineQty', {
                        qty: formatQty(line.qty),
                        uom: line.uomName,
                        price: formatMnt(line.unitPrice),
                      })}
                    </span>
                  </span>
                  <span className="shrink-0">{formatMnt(line.total)}</span>
                </p>
              ) : (
                <>
                  <p className="font-sans font-medium">{line.name}</p>
                  <p className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t('posKiosk.receipt.lineQty', {
                        qty: formatQty(line.qty),
                        uom: line.uomName,
                        price: formatMnt(line.unitPrice),
                      })}
                    </span>
                    <span>{formatMnt(line.total)}</span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      );
    case 'TOTALS': {
      const discount = new Decimal(receipt.discountTotal).gt(0);
      const big = block.large ? 'text-[1.15em]' : null;
      return (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5">
          {discount ? (
            <>
              <dt>{t('pos.fields.subtotal')}</dt>
              <dd className="text-right">{formatMnt(receipt.subtotal)}</dd>
              <dt>{t('pos.fields.discount')}</dt>
              <dd className="text-right">{`−${formatMnt(receipt.discountTotal)}`}</dd>
            </>
          ) : null}
          {(receipt.vouchers ?? [])
            .filter((voucher) => voucher.kind === 'COUPON')
            .map((voucher) => (
              <Fragment key={voucher.code}>
                <dt className="text-muted-foreground">
                  {`${t('posKiosk.vouchers.kinds.COUPON')}: ${voucher.name}`}
                </dt>
                <dd className="text-right text-muted-foreground">{`−${formatMnt(voucher.amount)}`}</dd>
              </Fragment>
            ))}
          <dt className={cn('font-sans font-semibold', big)}>{t('pos.fields.total')}</dt>
          <dd className={cn('text-right font-semibold', big)}>{formatTugrik(receipt.total)}</dd>
          {credit ? null : (
            <>
              <dt className="text-muted-foreground">{t('posKiosk.receipt.vatIncluded')}</dt>
              <dd className="text-right text-muted-foreground">{formatMnt(receipt.vatTotal)}</dd>
            </>
          )}
        </dl>
      );
    }
    case 'PAYMENTS':
      return (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5">
          {info.refund ? (
            receipt.tenders.map((tender, index) => (
              <RefundRow key={index} kind={tender.kind} amount={tender.amount} />
            ))
          ) : (
            <>
              {receipt.tenders.map((tender, index) => (
                <TenderRow key={index} tender={tender} showTendered={block.showTendered} />
              ))}
              <dt className="font-sans font-semibold">{t('pos.fields.change')}</dt>
              <dd className="text-right font-semibold">{formatTugrik(receipt.change)}</dd>
            </>
          )}
        </dl>
      );
    case 'LOYALTY':
      return receipt.loyalty ? <LoyaltyBlock loyalty={receipt.loyalty} /> : null;
    case 'EBARIMT':
      return info.real ? <EbarimtBlock info={info} /> : null;
    case 'SIGNATURE':
      return credit ? (
        <p className="mt-1.5 border-t border-dashed border-input pt-6 font-sans text-[0.9em]">
          {t('posKiosk.receipt.signature')}
          <span className="block text-muted-foreground">{t('posKiosk.receipt.signatureHint')}</span>
        </p>
      ) : null;
    case 'FOOTER':
      return (
        <p className="pt-3 text-center font-sans text-[0.9em] text-muted-foreground">
          {receipt.footer ?? t('posKiosk.receipt.thanks')}
        </p>
      );
    case 'TEXT':
      return (
        <p
          className={cn(
            'my-0.5 py-0.5 font-sans whitespace-pre-line',
            ALIGN[block.align],
            TEXT_SIZE[block.size],
            block.bold ? 'font-semibold' : null,
            block.inverse ? 'rounded-sm bg-foreground px-1.5 text-background' : null,
          )}
        >
          {fillReceiptText(block.text, info.values)}
        </p>
      );
    case 'LOGO':
      return (
        <img
          src={block.image}
          alt=""
          className={cn('my-1 block h-auto [image-rendering:pixelated]', SELF[block.align])}
          style={{ width: `${block.width}%` }}
        />
      );
    case 'QR':
      return (
        <figure className="my-1.5 text-center">
          <QrCode
            data={block.data}
            label={block.caption ?? block.data}
            className={QR_SIZE[block.size]}
          />
          {block.caption ? (
            <figcaption className="pt-1 font-sans text-[0.9em]">{block.caption}</figcaption>
          ) : null}
        </figure>
      );
    case 'BARCODE': {
      const code = info.tillId === null ? null : posReceiptBarcode(info.tillId, receipt.number);
      return code ? (
        <figure className="my-1.5 text-center">
          <Code128Svg
            value={code}
            label={t('posKiosk.receipt.barcode', { number: receipt.number })}
            className="mx-auto block h-12 w-[85%] text-foreground print:h-[12mm]"
          />
          {block.showNumber ? (
            <figcaption className="pt-0.5 text-[0.9em] tracking-wider">{code}</figcaption>
          ) : null}
        </figure>
      ) : null;
    }
    case 'DIVIDER':
      return (
        <hr
          className={cn(
            'my-1.5 border-input',
            block.rule === 'DASHED'
              ? 'border-t border-dashed'
              : block.rule === 'SOLID'
                ? 'border-t border-foreground/60'
                : 'h-1 border-y border-foreground/60',
          )}
        />
      );
    case 'SPACE':
      return <div aria-hidden className={SPACE[block.size]} />;
  }
}

/** The heading: the title, the seller, its TIN on a real receipt, and every banner that applies. */
function Heading({
  block,
  info,
}: {
  block: Extract<ReceiptBlock, { type: 'HEADING' }>;
  info: Facts;
}) {
  const { t } = useTranslation();
  const { receipt, credit } = info;
  const facts = receipt.ebarimt;
  const title = block.title ?? receipt.title;
  const banner = 'rounded-md px-2 py-1 font-sans text-[1.1em] font-semibold tracking-wide';
  return (
    <header className={cn('space-y-1 pb-1.5', ALIGN[block.align])}>
      {title ? (
        <p
          className={cn(
            'font-sans font-semibold whitespace-pre-line',
            block.size === 'LG'
              ? 'text-[1.6em]'
              : block.size === 'SM'
                ? 'text-[1.1em]'
                : 'text-[1.35em]',
          )}
        >
          {title}
        </p>
      ) : null}
      {block.showCompany || !title ? (
        <p className={cn('font-sans', title ? 'text-[0.9em]' : 'text-[1.35em] font-semibold')}>
          {facts.merchantName ?? receipt.companyName ?? t('brand.company')}
        </p>
      ) : null}
      {info.real && facts.merchantTin ? (
        <p className="text-[0.9em]">
          {t('posKiosk.receipt.sellerTin', { tin: facts.merchantTin })}
        </p>
      ) : null}
      {info.copy ? (
        <p className={cn(banner, 'border border-foreground tracking-widest')}>
          {t('posKiosk.receipt.copy')}
        </p>
      ) : null}
      {credit ? (
        <p className={cn(banner, 'border border-foreground')}>{t('posKiosk.receipt.creditSlip')}</p>
      ) : null}
      {credit && info.copyLabel ? <p className="font-sans text-[0.9em]">{info.copyLabel}</p> : null}
      {facts.mode === 'TEST' && credit === null ? (
        <p className={cn(banner, 'bg-warning-soft text-warning')}>{t('posKiosk.receipt.test')}</p>
      ) : null}
      {info.refund ? (
        <p className={cn(banner, 'bg-danger-soft text-destructive')}>
          {t('posKiosk.receipt.returnBanner')}
        </p>
      ) : null}
    </header>
  );
}

/** The number and the time; the POS and the cashier as set; the returned sale, the customer, the buyer and the ДДТД whenever there. */
function DocInfo({
  showTill,
  showCashier,
  info,
}: {
  showTill: boolean;
  showCashier: boolean;
  info: Facts;
}) {
  const { t } = useTranslation();
  const { receipt, credit } = info;
  const facts = receipt.ebarimt;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 py-1.5">
      <dt className="text-muted-foreground">{t('pos.fields.number')}</dt>
      <dd className="text-right font-semibold">{receipt.number}</dd>
      <dt className="text-muted-foreground">{t('pos.fields.soldAt')}</dt>
      <dd className="text-right">{formatUbDateTime(Date.parse(receipt.soldAt))}</dd>
      {info.refund && receipt.refundsNumber ? (
        <>
          <dt className="text-muted-foreground">{t('posKiosk.receipt.refunds')}</dt>
          <dd className="text-right">{receipt.refundsNumber}</dd>
        </>
      ) : null}
      {showTill ? (
        <>
          <dt className="text-muted-foreground">{t('pos.fields.till')}</dt>
          <dd className="text-right">{receipt.tillCode}</dd>
        </>
      ) : null}
      {showCashier ? (
        <>
          <dt className="text-muted-foreground">{t('pos.fields.cashier')}</dt>
          <dd className="truncate text-right">{receipt.cashierName}</dd>
        </>
      ) : null}
      {credit ? (
        <>
          <dt className="text-muted-foreground">{t('posKiosk.receipt.creditCustomer')}</dt>
          <dd className="text-right font-semibold">
            {credit.customerName}
            <span className="block font-normal">{credit.customerCode}</span>
          </dd>
        </>
      ) : null}
      {facts.receiptType === 'B2B' && facts.customerTin ? (
        <>
          <dt className="text-muted-foreground">{t('posKiosk.receipt.buyer')}</dt>
          <dd className="text-right">
            {facts.customerName}
            <span className="block">
              {t('posKiosk.receipt.buyerTin', { tin: facts.customerTin })}
            </span>
          </dd>
        </>
      ) : null}
      {facts.ddtd ? (
        <>
          <dt className="text-muted-foreground">{t('pos.fields.ddtd')}</dt>
          <dd className="text-right break-all">{facts.ddtd}</dd>
        </>
      ) : null}
    </dl>
  );
}

/** The e-Barimt part: its state, the replaced receipt, the lottery and the QR code. */
function EbarimtBlock({ info }: { info: Facts }) {
  const { t } = useTranslation();
  const { receipt, print } = info;
  const facts = receipt.ebarimt;
  const notice = info.waiting
    ? t('posKiosk.receipt.ebarimtPending')
    : facts.status === 'INDETERMINATE'
      ? t('posKiosk.receipt.ebarimtCheck')
      : facts.status === 'ERROR'
        ? t('posKiosk.receipt.ebarimtError')
        : facts.status === 'CANCELLED' && receipt.kind === 'SALE'
          ? t('posKiosk.receipt.ebarimtCancelled')
          : null;
  return (
    <section
      aria-label={t('posKiosk.receipt.ebarimt')}
      className="mt-1.5 space-y-2 border-t border-dashed border-input pt-3 text-center"
    >
      {notice ? (
        <p className="rounded-md bg-warning-soft px-2 py-1 font-sans text-[0.9em] font-semibold text-warning">
          {notice}
        </p>
      ) : null}
      {receipt.kind === 'RETURN' && facts.inactiveId ? (
        <p className="text-[0.9em] break-all">
          {t('posKiosk.receipt.replaced', { ddtd: facts.inactiveId })}
        </p>
      ) : null}
      {print?.lottery ? (
        <p className="font-sans text-[1.1em] font-semibold">
          {t('posKiosk.receipt.lottery', { lottery: print.lottery })}
        </p>
      ) : null}
      {print?.qrData ? <QrCode data={print.qrData} label={t('posKiosk.receipt.qr')} /> : null}
    </section>
  );
}

/**
 * The bonus card's part (ADR-0112): the member, the tier the sale earned at, the points earned,
 * spent, given back and taken back, and the balance after it as the till counts it.
 */
function LoyaltyBlock({ loyalty }: { loyalty: NonNullable<EdgeReceipt['loyalty']> }) {
  const { t } = useTranslation();
  const rows: [string, string, string][] = [
    [t('posKiosk.loyalty.receipt.earned'), `+${formatMnt(loyalty.earned)}`, loyalty.earned],
    [t('posKiosk.loyalty.receipt.spent'), `−${formatMnt(loyalty.spent)}`, loyalty.spent],
    [
      t('posKiosk.loyalty.receipt.givenBack'),
      `+${formatMnt(loyalty.givenBack)}`,
      loyalty.givenBack,
    ],
    [t('posKiosk.loyalty.receipt.clawback'), `−${formatMnt(loyalty.clawback)}`, loyalty.clawback],
  ];
  return (
    <section
      aria-label={t('posKiosk.loyalty.title')}
      className="mt-1.5 border-t border-dashed border-input pt-3"
    >
      <p className="font-sans font-semibold">
        {t('posKiosk.loyalty.receipt.member', { name: loyalty.memberName, phone: loyalty.phone })}
      </p>
      {loyalty.tierName ? (
        <p className="font-sans text-[0.9em] text-muted-foreground">
          {t('posKiosk.loyalty.tier', {
            name: loyalty.tierName,
            percent: formatMnt(loyalty.percent),
          })}
        </p>
      ) : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        {rows
          .filter(([, , amount]) => !new Decimal(amount).isZero())
          .map(([name, value]) => (
            <Fragment key={name}>
              <dt>{name}</dt>
              <dd className="text-right">{value}</dd>
            </Fragment>
          ))}
        <dt className="font-sans font-semibold">{t('posKiosk.loyalty.receipt.balance')}</dt>
        <dd className="text-right font-semibold">{formatMnt(loyalty.balance)}</dd>
      </dl>
    </section>
  );
}

/** What a return paid back: off the customer's debt (a credit sale's) or in cash. */
function RefundRow({ kind, amount }: { kind: string; amount: string }) {
  const { t } = useTranslation();
  return (
    <>
      <dt className="font-sans font-semibold">
        {kind === 'CREDIT'
          ? t('posKiosk.receipt.creditRefund')
          : kind === 'POINTS'
            ? t('posKiosk.receipt.pointsRefund')
            : t('posKiosk.receipt.refund')}
      </dt>
      <dd className="text-right font-semibold">{formatTugrik(amount)}</dd>
    </>
  );
}

function TenderRow({
  tender,
  showTendered,
}: {
  tender: EdgeReceipt['tenders'][number];
  showTendered: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <dt>{t(`pos.tenderKinds.${tender.kind}`)}</dt>
      <dd className="text-right">
        {formatMnt(tender.amount)}
        {showTendered &&
        tender.tendered !== null &&
        !new Decimal(tender.tendered).eq(tender.amount) ? (
          <span className="block text-[0.9em] text-muted-foreground">
            {t('posKiosk.receipt.tendered', { amount: formatMnt(tender.tendered) })}
          </span>
        ) : null}
      </dd>
    </>
  );
}
