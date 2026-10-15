import { Navigate, useParams, useSearchParams } from 'react-router';

/**
 * The old «Шинэ захиалга» page (ADR-0055): a new order now starts in the work page's create dialog
 * (ADR-0059), with the pipeline and the stage it was asked for.
 */
export function SalesOrderNewPage() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ new: '1' });
  for (const key of ['pipeline', 'stage']) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return <Navigate to={`/sales/boards?${next.toString()}`} replace />;
}

/** The old order page (ADR-0055): an order opens in the work page's panel (ADR-0059). */
export function SalesOrderPage() {
  const id = Number.parseInt(useParams().id ?? '', 10);
  return <Navigate to={id > 0 ? `/sales/boards?order=${id}` : '/sales/boards'} replace />;
}
