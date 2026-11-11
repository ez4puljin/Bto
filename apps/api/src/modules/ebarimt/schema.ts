import {
  type ReceiptType,
  type RelayPayment,
  type RelayReceiptLine,
  WHOLESALE_CANCEL_STATUSES,
  WHOLESALE_RECEIPT_STATUSES,
} from '@tugeel/shared/mn';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonValue, money } from '../../common/db/types';
import { users } from '../identity/schema';

// Tables owned by the ebarimt module (ADR-0185, ADR-0074, docs/modules/ebarimt.md): the wholesale
// e-Barimt receipts, keyed by the source document, issued by the store PC's PosAPI through the
// store edge. A row holds the business request and the facts PosAPI answered — never a lottery or
// QR data (CLAUDE.md NEVER). Nothing is deleted (DELETE and TRUNCATE are revoked from `app`).

const at = (name: string) => timestamp(name, { withTimezone: true });
const ref = (name: string) => bigint(name, { mode: 'number' });

export const ebarimtReceipts = pgTable(
  'ebarimt_receipts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** The company the document belongs to (`bto.company_code`, ADR-0070). */
    companyCode: text('company_code').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceDocType: text('source_doc_type').notNull(),
    /** The source document's id as text (an invoice id); no foreign key (ADR-0074). */
    sourceDocId: text('source_doc_id').notNull(),
    sourceRevision: integer('source_revision').notNull().default(1),
    /** What the list shows: the document's number, its order and its buyer, as they were. */
    docNumber: text('doc_number').notNull(),
    orderNumber: text('order_number'),
    buyerName: text('buyer_name').notNull(),
    receiptType: text('receipt_type').$type<ReceiptType>().notNull(),
    status: text('status', { enum: WHOLESALE_RECEIPT_STATUSES }).notNull().default('PENDING'),
    /** Why it is ERROR (`WHOLESALE_ERROR_CODES`), with `message`. */
    errorCode: text('error_code'),
    message: text('message'),
    customerTin: text('customer_tin'),
    consumerNo: text('consumer_no'),
    lines: jsonValue('lines').$type<RelayReceiptLine[]>().notNull(),
    payments: jsonValue('payments').$type<RelayPayment[]>().notNull(),
    total: money('total').notNull(),
    vatTotal: money('vat_total').notNull(),
    cityTaxTotal: money('city_tax_total').notNull(),
    /** How many times an edge was handed the receipt to issue. */
    attempt: integer('attempt').notNull().default(0),
    claimedAt: at('claimed_at'),
    /** The edge node (`pos_edge_nodes.id`) that holds it; a plain id, pos is above this module. */
    claimedNodeId: ref('claimed_node_id'),
    claimedNodeCode: text('claimed_node_code'),
    nextAttemptAt: at('next_attempt_at'),
    ddtd: text('ddtd'),
    /** PosAPI's `date`, verbatim (architecture M12). */
    posapiDate: text('posapi_date'),
    issuedAt: at('issued_at'),
    /** The merchant PosAPI issued it for, as the edge reported (for the printed receipt). */
    merchantTin: text('merchant_tin'),
    merchantName: text('merchant_name'),
    /** An INDETERMINATE receipt a person looked up: who and when. */
    resolvedBy: ref('resolved_by').references(() => users.id),
    resolvedAt: at('resolved_at'),
    /** Null: no cancellation asked. */
    cancelStatus: text('cancel_status', { enum: WHOLESALE_CANCEL_STATUSES }),
    cancelReason: text('cancel_reason'),
    cancelRequestedAt: at('cancel_requested_at'),
    cancelAttempt: integer('cancel_attempt').notNull().default(0),
    cancelClaimedAt: at('cancel_claimed_at'),
    cancelNodeId: ref('cancel_node_id'),
    cancelNextAttemptAt: at('cancel_next_attempt_at'),
    cancelMessage: text('cancel_message'),
    cancelledAt: at('cancelled_at'),
    createdBy: ref('created_by').references(() => users.id),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ebarimt_receipts_source_key').on(
      t.companyCode,
      t.sourceSystem,
      t.sourceDocType,
      t.sourceDocId,
      t.sourceRevision,
    ),
    index('ebarimt_receipts_status_idx').on(t.status, t.id),
    index('ebarimt_receipts_cancel_idx')
      .on(t.cancelStatus, t.id)
      .where(sql`${t.cancelStatus} IS NOT NULL`),
    check(
      'ebarimt_receipts_status',
      sql`${t.status} IN ('PENDING', 'SENDING', 'CONFIRMED', 'ERROR', 'INDETERMINATE', 'CANCELLED')`,
    ),
    check(
      'ebarimt_receipts_cancel_status',
      sql`${t.cancelStatus} IS NULL OR ${t.cancelStatus} IN ('PENDING', 'SENDING', 'DONE', 'ERROR', 'INDETERMINATE')`,
    ),
    check('ebarimt_receipts_type', sql`${t.receiptType} IN ('B2C', 'B2B')`),
    check('ebarimt_receipts_revision', sql`${t.sourceRevision} >= 1`),
    check('ebarimt_receipts_attempts', sql`${t.attempt} >= 0 AND ${t.cancelAttempt} >= 0`),
    check('ebarimt_receipts_money', sql`${t.total} > 0 AND ${t.vatTotal} >= 0`),
    // A confirmed receipt names its ДДТД and PosAPI's date; a claimed one its claim.
    check(
      'ebarimt_receipts_confirmed',
      sql`${t.status} <> 'CONFIRMED' OR (${t.ddtd} IS NOT NULL AND ${t.posapiDate} IS NOT NULL)`,
    ),
    check('ebarimt_receipts_sending', sql`${t.status} <> 'SENDING' OR ${t.claimedAt} IS NOT NULL`),
    check('ebarimt_receipts_ddtd', sql`${t.ddtd} IS NULL OR ${t.ddtd} ~ '^[0-9]{20,40}$'`),
    // PosAPI's date is kept as it came; only its length is bounded.
    check(
      'ebarimt_receipts_posapi_date',
      sql`${t.posapiDate} IS NULL OR length(${t.posapiDate}) BETWEEN 1 AND 40`,
    ),
  ],
);
