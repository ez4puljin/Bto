import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Invoice = Schemas['Invoice'];
export type InvoiceDetail = Schemas['InvoiceDetail'];
export type InvoiceLine = Schemas['InvoiceLine'];
export type Settlement = Invoice['settlement'];
export type CreditNote = Schemas['CreditNote'];
export type CreditNoteDetail = Schemas['CreditNoteDetail'];
export type CreditNoteRequest = Schemas['CreditNoteRequest'];
export type Payment = Schemas['Payment'];
export type PaymentDetail = Schemas['PaymentDetail'];
export type PaymentRequest = Schemas['PaymentRequest'];
export type PaymentKind = Payment['kind'];
export type PaymentStatus = Payment['status'];
export type CashBookRow = Schemas['CashBookRow'];
export type MoneyAccount = Schemas['MoneyAccount'];
export type MoneyAccountRequest = Schemas['MoneyAccountRequest'];
export type MoneyAccountPatch = Schemas['MoneyAccountPatch'];
export type GlAccount = Schemas['GlAccount'];
export type GlAccountRequest = Schemas['GlAccountRequest'];
export type GlAccountPatch = Schemas['GlAccountPatch'];
export type GlRole = NonNullable<GlAccount['role']>;
export type AccountLedgerLine = Schemas['AccountLedgerLine'];
export type JournalEntry = Schemas['JournalEntry'];
export type JournalEntryDetail = Schemas['JournalEntryDetail'];
export type JournalEntryRequest = Schemas['JournalEntryRequest'];
export type JournalSource = JournalEntry['source'];
export type CustomerBalance = Schemas['CustomerBalance'];
export type LedgerEntry = Schemas['LedgerEntry'];
export type FinanceNumbering = Schemas['FinanceNumbering'];
export type FinanceNumberingRequest = Schemas['FinanceNumberingRequest'];
export type FinanceAttention = Schemas['FinanceAttention'];
export type OpenItem = Schemas['OpenItem'];
export type AllocationRequest = Schemas['AllocationRequest'];
export type InvoiceAllocation = Schemas['InvoiceAllocation'];
export type SupplierBalance = Schemas['SupplierBalance'];
export type PayableEntry = Schemas['PayableEntry'];
export type PayableOpenItem = Schemas['PayableOpenItem'];

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

const KEYS = {
  invoices: ['finance', 'invoices'] as const,
  creditNotes: ['finance', 'credit-notes'] as const,
  payments: ['finance', 'payments'] as const,
  moneyAccounts: ['finance', 'money-accounts'] as const,
  book: ['finance', 'book'] as const,
  accounts: ['finance', 'gl-accounts'] as const,
  accountLedger: ['finance', 'account-ledger'] as const,
  journal: ['finance', 'journal'] as const,
  balances: ['finance', 'balances'] as const,
  supplierBalances: ['finance', 'supplier-balances'] as const,
  ledger: ['finance', 'ledger'] as const,
  openItems: ['finance', 'open-items'] as const,
  numbering: ['finance', 'numbering'] as const,
};

export interface InvoiceFilter {
  q?: string;
  customerId?: number;
  orderId?: number;
  settlement?: Settlement;
  status?: Invoice['status'];
  overdue?: boolean;
  from?: string;
  to?: string;
}

export function useInvoices(filter: InvoiceFilter, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.invoices, 'list', filter],
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/invoices', {
          params: {
            query: {
              q: filter.q || undefined,
              customerId: filter.customerId,
              orderId: filter.orderId,
              settlement: filter.settlement,
              status: filter.status,
              overdue: filter.overdue,
              from: filter.from,
              to: filter.to,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.invoices, id],
    enabled: id !== null && id > 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/invoices/{id}', { params: { path: { id: id ?? 0 } }, signal })),
  });
}

/** The invoice of an order, for the order panel: the first match, or null. */
export function useOrderInvoice(orderId: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.invoices, 'order', orderId],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/invoices', {
          params: { query: { orderId, limit: 1 } },
          signal,
        }),
      ).data[0] ?? null,
  });
}

export function useCreditNotes(filter: { invoiceId?: number; customerId?: number }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.creditNotes, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/credit-notes', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export interface PaymentFilter {
  q?: string;
  moneyAccountId?: number;
  customerId?: number;
  kind?: PaymentKind;
  status?: PaymentStatus;
  from?: string;
  to?: string;
}

export function usePayments(filter: PaymentFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.payments, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/payments', {
          params: {
            query: {
              q: filter.q || undefined,
              moneyAccountId: filter.moneyAccountId,
              customerId: filter.customerId,
              kind: filter.kind,
              status: filter.status,
              from: filter.from,
              to: filter.to,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function usePayment(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.payments, id],
    enabled: id !== null && id > 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/payments/{id}', { params: { path: { id: id ?? 0 } }, signal })),
  });
}

export function useMoneyAccounts() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.moneyAccounts,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/money-accounts', { signal })),
  });
}

export function useCashBook(moneyAccountId: number | null, range: { from?: string; to?: string }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.book, moneyAccountId, range],
    enabled: moneyAccountId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/money-accounts/{id}/book', {
          params: {
            path: { id: moneyAccountId ?? 0 },
            query: { from: range.from, to: range.to, cursor: pageParam, limit: 50 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useGlAccounts() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.accounts,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/gl-accounts', { signal })),
  });
}

export function useAccountLedger(accountId: number | null, range: { from?: string; to?: string }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.accountLedger, accountId, range],
    enabled: accountId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/gl-accounts/{id}/ledger', {
          params: {
            path: { id: accountId ?? 0 },
            query: { from: range.from, to: range.to, cursor: pageParam, limit: 50 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export interface JournalFilter {
  from?: string;
  to?: string;
  source?: JournalSource;
  accountId?: number;
  customerId?: number;
}

export function useJournal(filter: JournalFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.journal, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/journal-entries', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useJournalEntry(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.journal, id],
    enabled: id !== null && id > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/journal-entries/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useCustomerBalances(filter: { q?: string; overdue?: boolean }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.balances, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/customer-balances', {
          params: {
            query: {
              q: filter.q || undefined,
              overdue: filter.overdue,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCustomerBalance(customerId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.balances, customerId],
    enabled: enabled && customerId > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/customer-balances/{customerId}', {
          params: { path: { customerId } },
          signal,
        }),
      ),
  });
}

export function useCustomerLedger(customerId: number, range: { from?: string; to?: string }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.ledger, customerId, range],
    enabled: customerId > 0,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/customer-balances/{customerId}/ledger', {
          params: {
            path: { customerId },
            query: { from: range.from, to: range.to, cursor: pageParam, limit: 50 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** A customer's open receivable items (ADR-0090): invoices and refunds to settle, credits to use. */
export function useOpenItems(customerId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.openItems, customerId],
    enabled: enabled && customerId > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/customer-balances/{customerId}/open-items', {
          params: { path: { customerId } },
          signal,
        }),
      ).data,
  });
}

/** The suppliers' payables, largest first (F3, ADR-0091). */
export function useSupplierBalances(filter: { q?: string }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.supplierBalances, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/supplier-balances', {
          params: { query: { q: filter.q || undefined, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSupplierBalance(supplierId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.supplierBalances, supplierId],
    enabled: supplierId > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/supplier-balances/{supplierId}', {
          params: { path: { supplierId } },
          signal,
        }),
      ),
  });
}

export function useSupplierLedger(supplierId: number, range: { from?: string; to?: string }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.supplierBalances, supplierId, 'ledger', range],
    enabled: supplierId > 0,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/supplier-balances/{supplierId}/ledger', {
          params: {
            path: { supplierId },
            query: { from: range.from, to: range.to, cursor: pageParam, limit: 50 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** A supplier's open payable items (F3): bills to pay, payments and returns to pair with them. */
export function useSupplierOpenItems(supplierId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.supplierBalances, supplierId, 'open-items'],
    enabled: enabled && supplierId > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/supplier-balances/{supplierId}/open-items', {
          params: { path: { supplierId } },
          signal,
        }),
      ).data,
  });
}

export function useFinanceNumbering() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.numbering,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/finance-settings/numbering', { signal })),
  });
}

/** The home tile's counts (ADR-0060 #11): fresh for 30 s, read again every minute while visible. */
export function useFinanceAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'finance'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/finance/attention', { signal })),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useFinanceMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  // Every finance read, the sales reads (an invoice changes the order) and the home tile.
  const changed = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['sales'] }),
      queryClient.invalidateQueries({ queryKey: ATTENTION_KEY }),
    ]);
  return {
    voidInvoice: useMutation({
      mutationFn: async ({ id, key, reason }: Keyed<{ id: number; reason: string }>) =>
        unwrap(
          await api.POST('/api/v1/invoices/{id}/void', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { reason },
          }),
        ),
      onSuccess: () => changed(),
    }),
    createCreditNote: useMutation({
      mutationFn: async ({ key, body }: Keyed<{ body: CreditNoteRequest }>) =>
        unwrap(
          await api.POST('/api/v1/credit-notes', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => changed(),
    }),
    recordPayment: useMutation({
      mutationFn: async ({ key, body }: Keyed<{ body: PaymentRequest }>) =>
        unwrap(
          await api.POST('/api/v1/payments', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => changed(),
    }),
    voidPayment: useMutation({
      mutationFn: async ({ id, key, reason }: Keyed<{ id: number; reason: string }>) =>
        unwrap(
          await api.POST('/api/v1/payments/{id}/void', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { reason },
          }),
        ),
      onSuccess: () => changed(),
    }),
    allocate: useMutation({
      mutationFn: async ({ key, body }: Keyed<{ body: AllocationRequest }>) =>
        unwrap(
          await api.POST('/api/v1/finance/allocations', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => changed(),
    }),
    reverseAllocation: useMutation({
      mutationFn: async ({ id, key, reason }: Keyed<{ id: number; reason: string }>) =>
        unwrap(
          await api.POST('/api/v1/finance/allocations/{id}/reverse', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { reason },
          }),
        ),
      onSuccess: () => changed(),
    }),
    postEntry: useMutation({
      mutationFn: async ({ key, body }: Keyed<{ body: JournalEntryRequest }>) =>
        unwrap(
          await api.POST('/api/v1/journal-entries', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => changed(),
    }),
    reverseEntry: useMutation({
      mutationFn: async ({ id, key, description }: Keyed<{ id: number; description: string }>) =>
        unwrap(
          await api.POST('/api/v1/journal-entries/{id}/reverse', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { description },
          }),
        ),
      onSuccess: () => changed(),
    }),
    createAccount: useMutation({
      mutationFn: async (body: GlAccountRequest) =>
        unwrap(await api.POST('/api/v1/gl-accounts', { body })),
      onSuccess: () => changed(),
    }),
    updateAccount: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: GlAccountPatch }) =>
        unwrap(await api.PUT('/api/v1/gl-accounts/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    setRole: useMutation({
      mutationFn: async ({ id, role }: { id: number; role: GlRole | null }) =>
        unwrap(
          await api.PUT('/api/v1/gl-accounts/{id}/role', {
            params: { path: { id } },
            body: { role },
          }),
        ),
      onSuccess: () => changed(),
    }),
    createMoneyAccount: useMutation({
      mutationFn: async (body: MoneyAccountRequest) =>
        unwrap(await api.POST('/api/v1/money-accounts', { body })),
      onSuccess: () => changed(),
    }),
    updateMoneyAccount: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: MoneyAccountPatch }) =>
        unwrap(await api.PUT('/api/v1/money-accounts/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    setNumbering: useMutation({
      mutationFn: async (body: FinanceNumberingRequest) =>
        unwrap(await api.PUT('/api/v1/finance-settings/numbering', { body })),
      onSuccess: () => changed(),
    }),
  };
}

export type FinancePeriod = Schemas['FinancePeriod'];
export type FinancePeriodEvent = Schemas['FinancePeriodEvent'];

const PERIOD_KEYS = {
  periods: ['finance', 'periods'] as const,
  events: ['finance', 'period-events'] as const,
};

/** The company's months with their status (ADR-0102), the newest first. */
export function useFinancePeriods() {
  const api = useApiClient();
  return useQuery({
    queryKey: PERIOD_KEYS.periods,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/finance/periods', { signal })).data,
  });
}

/** Every close and reopen, the newest first. */
export function useFinancePeriodEvents() {
  const api = useApiClient();
  return useQuery({
    queryKey: PERIOD_KEYS.events,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/finance/periods/events', { signal })).data,
  });
}

export function usePeriodMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: ['finance'] });
  return {
    close: useMutation({
      mutationFn: async ({ code, key }: Keyed<{ code: string }>) =>
        unwrap(
          await api.POST('/api/v1/finance/periods/{code}/close', {
            params: { path: { code }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: () => changed(),
    }),
    reopen: useMutation({
      mutationFn: async ({ code, key, reason }: Keyed<{ code: string; reason: string }>) =>
        unwrap(
          await api.POST('/api/v1/finance/periods/{code}/reopen', {
            params: { path: { code }, header: idempotencyKey(key) },
            body: { reason },
          }),
        ),
      onSuccess: () => changed(),
    }),
  };
}
