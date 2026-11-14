/**
 * What the store seed moves (ADR-0186 #5): every table of the centre is named here once, as
 * master data that is copied, as documents and history that stay empty, or as «not decided»,
 * which also stays empty until the owner or the accountant says otherwise.
 *
 * A table a later migration adds and nobody listed here is treated as «not decided»: the dry run
 * names it and nothing of it is copied.
 */
export type SeedClass = 'copy' | 'empty' | 'undecided';

export interface SeedRule {
  class: SeedClass;
  /** Read by the owner in the dry run and in ADR-0186: why the table is treated this way. */
  note?: string;
  /**
   * Migrations write rows into this table, so a freshly migrated target is not empty here; the
   * seed merges by primary key instead of inserting.
   */
  seeded?: true;
  /** Columns that never travel: the value written instead (null, or the column's text form). */
  set?: Record<string, string | null>;
  /** Copy only the rows another copied table points at (the files of copied records). */
  onlyReferenced?: true;
  /**
   * Nullable columns written after every table is in, because two copied tables point at each
   * other: the rows go in with NULL here and get the value in a second step.
   */
  late?: string[];
  /**
   * For an append-only table the migrations seed: rows are matched by what they say, not by their
   * id, and the source's rows the target lacks are appended with new ids. `identity` is the
   * generated key left out of the comparison; within `latestOf` the row with the highest id is
   * the one in force, and it must say the same on both sides afterwards.
   */
  appendByContent?: { identity: string; latestOf: string[] };
}

const copy = (note?: string, extra: Omit<SeedRule, 'class' | 'note'> = {}): SeedRule => ({
  class: 'copy',
  ...(note ? { note } : {}),
  ...extra,
});
const empty = (note?: string): SeedRule => ({ class: 'empty', ...(note ? { note } : {}) });
const undecided = (note: string): SeedRule => ({ class: 'undecided', note });

const DOCUMENT = 'documents';
const HISTORY = 'history and activity';
const STATE = 'state the system rebuilds';
const SESSION = 'sign-in state';

/** Keyed by `schema.table`; partitions follow their parent. */
export const STORE_SEED_TABLES: Record<string, SeedRule> = {
  // --- identity and the organisation
  'public.users': copy('staff with their password hashes: everybody keeps the sign-in'),
  'public.roles': copy(),
  'public.permissions': copy(),
  'public.role_permissions': copy(),
  'public.role_permission_overrides': copy(),
  'public.user_roles': copy(),
  'public.user_company_roles': copy(),
  'public.user_scopes': copy(),
  'public.branches': copy(),
  'public.settings': copy('VAT and city-tax rates and the other dated settings'),
  'public.company_contacts': copy(),
  'public.auth_sessions': empty(SESSION),
  'public.password_resets': empty(SESSION),
  'public.audit_log': empty(HISTORY),
  'public.idempotency_keys': empty(STATE),
  'public.number_sequences': empty('document counters: every number starts again'),
  'public.files': copy('only the files of copied records (product pictures, staff photos)', {
    onlyReferenced: true,
  }),

  // --- warehouses and the catalog
  'public.warehouses': copy(),
  'public.bins': copy(),
  'public.uoms': copy(),
  'public.categories': copy(),
  'public.products': copy(),
  'public.product_units': copy(),
  'public.product_barcodes': copy(),
  'public.product_images': copy(),
  'public.product_locations': copy('home warehouse, default bin, minimum and maximum'),
  'public.product_suppliers': copy(),
  'public.segments': copy(),
  'public.segment_products': copy(),

  // --- partners
  'public.customers': copy(),
  'public.customer_categories': copy(),
  'public.customer_addresses': copy(),
  'public.customer_contacts': copy(),
  'public.suppliers': copy(),
  'public.supplier_categories': copy(),
  'public.supplier_contacts': copy(),
  'public.supplier_orderers': copy(),
  'public.supplier_orderer_history': empty(HISTORY),
  'public.trucks': copy(),

  // --- pricing
  'public.price_profiles': copy(),
  'public.price_profile_versions': copy(),
  'public.product_prices': copy(),
  'public.discount_programs': copy(),
  'public.discount_program_links': copy(),
  'public.discount_steps': copy(),

  // --- stock: starts at zero, counted or imported before the pilot day (ADR-0186 #6)
  'public.stock_ledger': empty(DOCUMENT),
  'public.bin_stock': empty('balances: stock starts at zero'),
  'public.warehouse_stock': empty('balances and average costs: stock starts at zero'),
  'public.lots': empty('lots arrive with receipts'),
  'public.stock_reservations': empty(DOCUMENT),
  'public.stock_snapshot_daily': empty(STATE),
  'public.stock_snapshot_bin_monthly': empty(STATE),
  'public.stock_valuation_adjustments': empty(DOCUMENT),
  'public.reconciliation_runs': empty(HISTORY),
  'public.adjustments': empty(DOCUMENT),
  'public.adjustment_lines': empty(DOCUMENT),
  'public.bin_moves': empty(DOCUMENT),
  'public.bin_move_lines': empty(DOCUMENT),
  'public.transfers': empty(DOCUMENT),
  'public.transfer_lines': empty(DOCUMENT),
  'public.transfer_requests': empty(DOCUMENT),
  'public.goods_receipts': empty(DOCUMENT),
  'public.goods_receipt_lines': empty(DOCUMENT),
  'public.goods_receipt_confirmations': empty(DOCUMENT),
  'public.goods_receipt_discounts': empty(DOCUMENT),
  'public.goods_receipt_discount_lines': empty(DOCUMENT),
  'public.goods_issues': empty(DOCUMENT),
  'public.goods_issue_lines': empty(DOCUMENT),
  'public.goods_issue_confirmations': empty(DOCUMENT),
  'public.issue_expense_types': copy(undefined, { seeded: true }),
  'public.stocktakes': empty(DOCUMENT),
  'public.stocktake_bins': empty(DOCUMENT),
  'public.stocktake_lines': empty(DOCUMENT),
  'public.stock_count_sessions': empty(DOCUMENT),
  'public.stock_count_entries': empty(DOCUMENT),
  'public.stock_count_lines': empty(DOCUMENT),

  // --- procurement
  'public.purchase_orders': empty(DOCUMENT),
  'public.purchase_order_lines': empty(DOCUMENT),
  'public.purchase_order_suppliers': empty(DOCUMENT),
  'public.purchase_order_loads': empty(DOCUMENT),
  'public.purchase_order_load_lines': empty(DOCUMENT),
  'public.purchase_order_invoice_checks': empty(DOCUMENT),

  // --- sales
  'public.sales_boards': copy(),
  'public.sales_pipelines': copy(undefined, { late: ['loaded_stage_id'] }),
  'public.sales_pipeline_roles': copy(),
  'public.sales_stages': copy(),
  'public.sales_stage_roles': copy(),
  'public.sales_channel_defaults': copy(),
  'public.sales_settings': copy(),
  'public.sales_document_templates': copy(),
  'public.sales_document_template_versions': copy(),
  'public.rep_visit_plans': copy("the reps' weekly rounds"),
  'public.sales_orders': empty(DOCUMENT),
  'public.sales_order_lines': empty(DOCUMENT),
  'public.sales_order_line_parts': empty(DOCUMENT),
  'public.sales_order_excluded_lines': empty(DOCUMENT),
  'public.sales_order_picks': empty(DOCUMENT),
  'public.sales_order_loads': empty(DOCUMENT),
  'public.sales_order_changes': empty(HISTORY),
  'public.sales_stage_moves': empty(HISTORY),
  'public.order_status_events': empty(HISTORY),
  'public.rep_visits': empty(DOCUMENT),
  'public.rep_collections': empty(DOCUMENT),

  // --- finance (Bto's side)
  'public.finance_settings': copy(),
  'public.statement_row_links': copy("the accountant's account-to-row links of СТ-1 and СТ-2"),
  'public.bank_statement_settings': copy(),
  'public.invoices': empty(DOCUMENT),
  'public.invoice_lines': empty(DOCUMENT),
  'public.credit_notes': empty(DOCUMENT),
  'public.credit_note_lines': empty(DOCUMENT),
  'public.bank_statements': empty(DOCUMENT),
  'public.bank_statement_lines': empty(DOCUMENT),
  'public.finance_reconcile_runs': empty(HISTORY),
  'public.ebarimt_receipts': empty(DOCUMENT),

  // --- the supermarket's tills
  'public.pos_settings': copy(),
  'public.pos_edge_nodes': copy('without its token, link code and last-seen facts: linked anew', {
    set: {
      token_hash: null,
      token_prefix: null,
      token_issued_at: null,
      app_version: null,
      last_seen_at: null,
      last_pull_at: null,
      last_push_at: null,
      backlog: '0',
      clock_skew_ms: null,
      snapshot_version: null,
      posapi_version: null,
      posapi_last_sent: null,
      posapi_left_lotteries: null,
      posapi_checked_at: null,
      posapi_error: null,
      link_code_hash: null,
      link_expires_at: null,
      link_attempts: '0',
    },
  }),
  'public.pos_tills': copy('without pairing codes', {
    set: { pairing_code_hash: null, pairing_expires_at: null, last_sale_at: null },
  }),
  'public.pos_till_users': copy(),
  'public.pos_till_categories': copy(),
  'public.pos_payment_types': copy(undefined, { seeded: true }),
  'public.pos_quick_groups': copy(),
  'public.pos_quick_buttons': copy(),
  'public.pos_receipt_templates': copy(),
  'public.pos_receipt_template_versions': copy(),
  'public.pos_loyalty_tiers': copy(),
  'public.pos_cashiers': empty(
    'PINs are keyed by POS_PIN_PEPPER, which is new on the store PC: every PIN is set again',
  ),
  'public.pos_till_devices': empty('a browser binds to its POS again on its first visit'),
  'public.pos_loyalty_members': undecided('are the members registered so far real customers?'),
  'public.pos_loyalty_entries': empty(DOCUMENT),
  'public.pos_shifts': empty(DOCUMENT),
  'public.pos_sales': empty(DOCUMENT),
  'public.pos_sale_lines': empty(DOCUMENT),
  'public.pos_sale_loyalty': empty(DOCUMENT),
  'public.pos_sale_vouchers': empty(DOCUMENT),
  'public.pos_tenders': empty(DOCUMENT),
  'public.pos_voids': empty(DOCUMENT),
  'public.pos_void_lines': empty(DOCUMENT),
  'public.pos_day_counts': empty(DOCUMENT),
  'public.pos_shortfalls': empty(DOCUMENT),
  'public.pos_sync_rejections': empty(DOCUMENT),
  'public.pos_voucher_batches': empty(DOCUMENT),
  'public.pos_vouchers': empty(DOCUMENT),

  // --- HR
  'public.hr_divisions': copy(),
  'public.hr_employees': copy(),
  'public.hr_employee_children': copy(),
  'public.hr_employee_sites': copy(),
  'public.hr_work_sites': copy(),
  'public.hr_schedules': copy(),
  'public.hr_settings': copy(),
  'public.hr_event_types': copy(undefined, { seeded: true }),
  'public.hr_request_types': copy(),
  'public.hr_events': undecided(
    'the calendar carried from the old system (tools/hr-calendar-carry carries it again)',
  ),
  'public.hr_attendance_events': empty(DOCUMENT),
  'public.hr_requests': empty(DOCUMENT),
  'public.hr_feedback': empty(HISTORY),
  'public.hr_location_shares': empty(HISTORY),
  'public.hr_messages': empty(HISTORY),
  'public.hr_message_recipients': empty(HISTORY),
  'public.hr_message_reads': empty(HISTORY),
  'public.hr_moods': empty(HISTORY),
  'public.hr_thanks': empty(HISTORY),
  'public.hr_polls': empty(HISTORY),
  'public.hr_poll_questions': empty(HISTORY),
  'public.hr_poll_options': empty(HISTORY),
  'public.hr_poll_recipients': empty(HISTORY),
  'public.hr_poll_answers': empty(HISTORY),

  // --- the apps
  'public.app_settings': copy('which segment the apps sell from'),
  'public.app_stock_warehouses': copy(),
  'public.staff_app_assortments': copy(),
  'public.staff_app_assortment_segments': copy(),
  'public.staff_app_assortment_users': copy(),
  'public.app_banners': undecided(
    'Bto300 banners: the customer app stays on the test server until the external server',
  ),
  'public.app_notices': undecided('Bto300 notices, as the banners'),
  'public.app_notice_products': undecided('Bto300 notices, as the banners'),
  'public.app_notice_reads': empty(HISTORY),
  'public.app_notice_customer_reads': empty(HISTORY),
  'public.customer_users': undecided(
    "the stores' Bto300 sign-ins made so far are test accounts; real stores sign up on the real server",
  ),
  'public.customer_password_codes': empty(SESSION),
  'public.customer_favourites': empty(HISTORY),
  'public.customer_notifications': empty(HISTORY),
  'public.user_notifications': empty(HISTORY),

  // --- «И-баримт шалгах» and «Хугацааны хяналт» (carried from the old system)
  'public.ebarimt_check_accounts': copy(),
  'public.ebarimt_check_supplier_profiles': copy(),
  'public.ebarimt_check_assignments': copy('which employee checks which supplier'),
  'public.ebarimt_check_files': undecided(
    'the months carried from the old system: real records, but test receipts were linked to them (tools/ebarimt-carry carries them again)',
  ),
  'public.ebarimt_check_entries': undecided('as ebarimt_check_files'),
  'public.ebarimt_check_month_values': undecided('as ebarimt_check_files'),
  'public.ebarimt_check_history': undecided('as ebarimt_check_files'),
  'public.ebarimt_check_receipt_links': empty('links to test receipts'),
  'public.expiry_items': undecided(
    'the register carried from the old system (tools/expiry-carry carries it again, as ADR-0172 plans for the cut-over)',
  ),
  'public.expiry_item_changes': undecided('as expiry_items'),
  'public.expiry_item_roles': undecided('as expiry_items'),
  'public.expiry_item_users': undecided('as expiry_items'),

  // --- imports and the AI assistant
  'public.import_jobs': empty(HISTORY),
  'public.import_rows': empty(HISTORY),
  'public.import_documents': empty(HISTORY),
  'public.ai_settings': empty(
    'the key is sealed with AI_KEY_SECRET, which is new on the store PC: typed again on «Тохиргоо → AI»',
  ),
  'public.ai_conversations': empty(HISTORY),
  'public.ai_questions': empty(HISTORY),
  'public.ai_usage': empty(HISTORY),
  'public.ai_reports': empty('saved reports are made again'),
  'public.report_views': empty('saved report views are made again'),
  'public.screen_usage': empty(HISTORY),
  'public.screen_usage_seen': empty(HISTORY),
  'reporting.refresh_state': empty(STATE),

  // --- the Finance Core: the organisation and the chart, never the books
  'fin.tenants': copy(undefined, { seeded: true }),
  'fin.companies': copy(undefined, { seeded: true }),
  'fin.company_tax_registrations': copy(),
  'fin.branches': copy(),
  'fin.branch_refs': copy(),
  'fin.source_systems': copy(undefined, { seeded: true }),
  'fin.source_grants': copy(undefined, { seeded: true }),
  'fin.account_groups': copy(),
  'fin.accounts': copy('the chart of accounts', { seeded: true }),
  'fin.money_accounts': copy('cash boxes and bank accounts'),
  'fin.document_types': copy(undefined, { seeded: true }),
  'fin.number_series': copy('number patterns, not the counters', { seeded: true }),
  'fin.posting_keys': copy(undefined, { seeded: true }),
  'fin.posting_rules': copy('appended by content: the rule ids are new, the rules are the same', {
    seeded: true,
    appendByContent: { identity: 'id', latestOf: ['company_id', 'posting_key', 'effective_from'] },
  }),
  'fin.parties': copy("the customers' and suppliers' parties", { seeded: true }),
  'fin.party_companies': copy(undefined, { seeded: true }),
  'fin.party_refs': copy(undefined, { seeded: true }),
  'fin.fiscal_periods': undecided(
    "the books' calendar: the accountant opens the periods at the cut-over (ADR-0102)",
  ),
  'fin.number_counters': empty('document counters: every number starts again'),
  'fin.party_balances': empty('balances: the books start empty'),
  'fin.documents': empty(DOCUMENT),
  'fin.journal_entries': empty(DOCUMENT),
  'fin.journal_lines': empty(DOCUMENT),
  'fin.open_items': empty(DOCUMENT),
  'fin.allocations': empty(DOCUMENT),
  'fin.intake_requests': empty(HISTORY),
  'fin.intake_attempts': empty(HISTORY),
  'fin.period_events': empty(HISTORY),
  'fin.reconcile_runs': empty(HISTORY),
  'fin.audit_log': empty(HISTORY),
};

/** Schemas the seed never looks into: migration bookkeeping, the job queue, the AI views. */
export const STORE_SEED_SKIPPED_SCHEMAS = ['drizzle', 'pgboss', 'ai'] as const;

/**
 * Tables of the target that may hold rows before the seed although nothing is copied into them:
 * a migration writes their single state row.
 */
export const STORE_SEED_STATE_TABLES = ['reporting.refresh_state'] as const;
