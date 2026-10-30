import { PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, LoadMore, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type GridRow,
  type PurchaseOrderSupplier,
  usePurchaseOrderMutations,
  usePurchaseOrderRows,
} from './api';

/**
 * «Бараа нэмэх» on a supplier's card (ADR-0122): a product the supplier shipped that the order
 * never listed — registered in the catalog first, with this supplier as its main supplier — is
 * searched here and added with a quantity and unit, while the supplier is still editable (up to
 * «Замд»). Each row saves on its own through the grid's save, so the history shows who added what.
 */
export function AddProductDialog(props: {
  orderId: number;
  supplier: PurchaseOrderSupplier;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const rows = usePurchaseOrderRows(props.orderId, props.supplier.supplierId, { q, filter: 'ALL' });
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const data = rows.data?.pages.flatMap((page) => page.data) ?? [];
  const [qty, setQty] = useState<Map<number, string>>(new Map());
  const [unit, setUnit] = useState<Map<number, number>>(new Map());

  const defaultUnit = (row: GridRow) => row.units[row.units.length - 1]?.id ?? 0;
  const add = (row: GridRow) => {
    const text = (qty.get(row.productId) ?? '').replace(/\s/g, '').replace(',', '.');
    if (!/^\d{1,11}(\.\d{1,3})?$/.test(text) || text === '0') return;
    void action.run(async () => {
      const result = await mutations.saveLines.mutateAsync({
        id: props.orderId,
        supplierId: props.supplier.supplierId,
        changes: [
          {
            productId: row.productId,
            field: 'ORDERED',
            productUnitId: unit.get(row.productId) ?? defaultUnit(row),
            qty: text,
            previousUnitId: null,
            previousQty: null,
          },
        ],
      });
      const refused = result.refused[0];
      if (refused) {
        const reason: string = t(`procurement.grid.refusal.${refused.reason}`);
        throw new Error(t('procurement.overview.refused', { reason }));
      }
      if (result.conflicts.length > 0) {
        throw new Error(t('procurement.overview.alreadyOrdered'));
      }
      toast.success(t('procurement.overview.productAdded', { name: row.name }));
      setQty((current) => {
        const next = new Map(current);
        next.delete(row.productId);
        return next;
      });
      await rows.refetch();
      props.onAdded();
    });
  };

  return (
    <DialogContent size="lg" closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>
          {t('procurement.overview.addProductTitle', { name: props.supplier.supplierName })}
        </DialogTitle>
      </DialogHeader>
      <p className="text-[13px] text-muted-foreground">
        {t('procurement.overview.addProductHint')}{' '}
        <Link to="/catalog/products/new" className="text-link underline-offset-4 hover:underline">
          {t('procurement.overview.registerProduct')}
        </Link>
      </p>
      <SearchField
        autoFocus
        placeholder={t('procurement.overview.productSearch')}
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <ProblemAlert problem={action.problem ?? problemFromError(rows.error)} />
      <div className="max-h-[50vh] overflow-auto rounded-lg border border-border/80">
        {rows.isPending ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : data.length === 0 ? (
          <EmptyState icon={PackagePlus} title={t('procurement.overview.noProducts')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('procurement.detail.columns.sku')}</TableHead>
                <TableHead>{t('procurement.detail.columns.name')}</TableHead>
                <TableHead className="w-[6rem] text-right">
                  {t('procurement.overview.qty')}
                </TableHead>
                <TableHead className="w-[8rem]">{t('procurement.overview.unit')}</TableHead>
                <TableHead className="w-[6rem]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell className="font-mono">{row.sku}</TableCell>
                  <TableCell>
                    {row.name}
                    {row.line ? (
                      <Badge variant="secondary" className="ml-2">
                        {t('procurement.overview.orderedBadge', { qty: formatQty(row.line.qty) })}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.line ? null : (
                      <Input
                        inputMode="decimal"
                        className="h-8 w-20 text-right font-mono"
                        aria-label={t('procurement.overview.qtyNamed', { name: row.name })}
                        disabled={!row.editable}
                        value={qty.get(row.productId) ?? ''}
                        onChange={(event) =>
                          setQty((current) =>
                            new Map(current).set(row.productId, event.target.value),
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            add(row);
                          }
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {row.line ? null : (
                      <NativeSelect
                        aria-label={t('procurement.overview.unitNamed', { name: row.name })}
                        value={String(unit.get(row.productId) ?? defaultUnit(row))}
                        disabled={!row.editable}
                        onChange={(event) =>
                          setUnit((current) =>
                            new Map(current).set(
                              row.productId,
                              Number.parseInt(event.target.value, 10),
                            ),
                          )
                        }
                      >
                        {row.units.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.line ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!row.editable || !(qty.get(row.productId) ?? '').trim()}
                        pending={mutations.saveLines.isPending}
                        onClick={() => add(row)}
                      >
                        {t('procurement.overview.addProduct')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <LoadMore query={rows} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={props.onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
