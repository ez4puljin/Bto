import { PRINT_KINDS, type PrintKind } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useWarehouses } from '@/features/identity/api';
import { useWarehouseName } from '@/features/inventory/helpers';
import { cn } from '@/lib/utils';
import { type SalesOrder, useSalesOrder } from './api';
import { useDocumentLayouts } from './document-templates-api';
import { DocumentView } from './document-view';
import { useOrderBatch } from './pipelines-api';
import { PrintFrame as SharedPrintFrame } from '@/components/print-frame';
import { useCompany, useCompanyName } from '@/features/company/api';

const isKind = (value: string | undefined): value is PrintKind =>
  value !== undefined && (PRINT_KINDS as readonly string[]).includes(value);

/**
 * A document of an order on paper (ADR-0056 #7): the pick list (no prices, per warehouse with the
 * shelf) or the delivery note (prices, totals, signatures), rendered without the shell and sent to
 * the browser's print dialog once loaded. Nothing is generated on the server.
 */
export function SalesOrderPrintPage() {
  const params = useParams();
  const id = Number.parseInt(params.id ?? '', 10);
  const kind = isKind(params.kind) ? params.kind : 'PICK_LIST';
  const order = useSalesOrder(id);
  return (
    <PrintFrame
      kind={kind}
      orders={order.data ? [order.data] : undefined}
      error={order.error}
      title={order.data ? (order.data.number ?? String(order.data.id)) : ''}
    />
  );
}

/**
 * Several orders on one printout (ADR-0057 #7, a stage's «Баримт хэвлэх»): `?ids=` names up to 100
 * orders, each on its own sheet; a delivery note leaves out the drafts, which have no prices.
 */
export function SalesBatchPrintPage() {
  const { t } = useTranslation();
  const params = useParams();
  const [search] = useSearchParams();
  const kind = isKind(params.kind) ? params.kind : 'PICK_LIST';
  const ids = (search.get('ids') ?? '')
    .split(',')
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => id > 0);
  const batch = useOrderBatch(ids);
  const orders = batch.data?.filter((order) => kind === 'PICK_LIST' || order.total !== null);
  return (
    <PrintFrame
      kind={kind}
      orders={orders}
      error={batch.error}
      title={t('sales.print.batchTitle', { count: orders?.length ?? 0 })}
    />
  );
}

/**
 * The orders on paper (ADR-0058): the shared frame, ready once the documents, the warehouse names,
 * the company and the templates are in; each order on its own sheet, drawn with its pipeline's
 * template of the kind (ADR-0143).
 */
function PrintFrame({
  kind,
  orders,
  error,
  title,
}: {
  kind: PrintKind;
  orders: SalesOrder[] | undefined;
  error: unknown;
  title: string;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const warehouseName = useWarehouseName();
  const company = useCompany();
  const companyName = useCompanyName();
  const layouts = useDocumentLayouts((orders ?? []).map((order) => order.pipelineId));
  const ready =
    (orders?.length ?? 0) > 0 && !warehouses.isPending && !company.isPending && !layouts.isPending;
  const printedAt = Date.now();
  return (
    <SharedPrintFrame
      ready={ready}
      error={error}
      title={`${title} · ${t(`sales.printKinds.${kind}`)}`}
      printLabel={t('sales.print.print')}
    >
      {(narrow) =>
        (orders ?? []).map((order, index, all) => (
          <section
            key={order.id}
            className={
              index < all.length - 1
                ? cn('break-after-page print:mb-0', narrow ? 'mb-6' : 'mb-10')
                : undefined
            }
          >
            <DocumentView
              kind={kind}
              order={order}
              layout={layouts.layoutOf(kind, order.pipelineId)}
              narrow={narrow}
              company={{
                name: companyName,
                tin: company.data?.tin ?? null,
                registerNo: company.data?.registerNo ?? null,
              }}
              printedAt={printedAt}
              warehouseName={warehouseName}
            />
          </section>
        ))
      }
    </SharedPrintFrame>
  );
}
