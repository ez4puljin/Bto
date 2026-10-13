import { Move } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EmptyState, FilterBar, ListCard, LoadMore, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBarcodeLookup } from '@/features/catalog/api';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type Bin, useBinLookup, useBinMoves, useInventoryMutations } from './api';
import { isQty, looksLikeLabel, useWarehouseName, useWarehouseOptions } from './helpers';
import { ProductSearch, WarehouseSelect } from './shared';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;

interface Item {
  productUnitId: number;
  productName: string;
  unitName: string;
}
interface PendingLine extends Item {
  enteredQty: string;
  from: Bin;
  to: Bin;
}

/** Bin moves (BM-): put-away from the receiving area and shelf-to-shelf moves, posted at once. */
export function BinMovesPage() {
  const { t } = useTranslation();
  const canMove = useHasPermission('inventory.moves.manage');
  const [params, setParams] = useSearchParams();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const warehouses = useWarehouseOptions(SHELF_KINDS, canMove);
  const warehouseName = useWarehouseName();
  const moves = useBinMoves({ warehouseId });
  const rows = moves.data?.pages.flatMap((page) => page.data) ?? [];

  const setWarehouse = (id: number | undefined) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id === undefined) next.delete('warehouseId');
        else next.set('warehouseId', String(id));
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader title={t('inventory.moves.title')} />
      <FilterBar>
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={canMove ? t('inventory.pickWarehouse') : t('inventory.allWarehouses')}
          onChange={setWarehouse}
        />
      </FilterBar>
      {canMove && warehouseId !== undefined ? (
        <div className="mb-4">
          <MoveForm key={warehouseId} warehouseId={warehouseId} />
        </div>
      ) : null}
      <ProblemAlert problem={problemFromError(moves.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.note')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {moves.isPending ? <SkeletonRows columns={5} /> : null}
            {rows.map((move) => (
              <TableRow key={move.id}>
                <TableCell className="font-mono">{move.number}</TableCell>
                <TableCell className="font-mono">{move.effectiveDate}</TableCell>
                <TableCell>{warehouseName(move.warehouseId)}</TableCell>
                <TableCell className="text-right font-mono">{move.lineCount}</TableCell>
                <TableCell className="whitespace-normal">{move.note ?? t('common.none')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!moves.isPending && rows.length === 0 ? (
          <EmptyState icon={Move} title={t('inventory.moves.empty')} />
        ) : null}
        <LoadMore query={moves} />
      </ListCard>
    </div>
  );
}

/**
 * Scan the shelf goods leave, the product and its quantity, then the shelf they go to; repeat,
 * then move them all in one document. A label scan fills "from" first, then "to".
 */
function MoveForm({ warehouseId }: { warehouseId: number }) {
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [from, setFrom] = useState<Bin | null>(null);
  const [to, setTo] = useState<Bin | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [qty, setQty] = useState('1');
  const [lines, setLines] = useState<PendingLine[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const guard = useScanGuard((code) => onScan(code), { letters: true });

  const reset = () => {
    setFrom(null);
    setTo(null);
    setItem(null);
    setQty('1');
    setLines([]);
  };

  function onScan(code: string) {
    void action.run(async () => {
      setMissing(null);
      const findBin = async () => {
        try {
          return await lookupBin.mutateAsync({ warehouseId, code });
        } catch (error) {
          if (problemFromError(error)?.code === 'NOT_FOUND') return null;
          throw error;
        }
      };
      const findUnit = async () => {
        try {
          return await lookupBarcode.mutateAsync(code);
        } catch (error) {
          if (problemFromError(error)?.code === 'NOT_FOUND') return null;
          throw error;
        }
      };
      const label = looksLikeLabel(code);
      const bin = label ? await findBin() : null;
      const resolved = bin ? null : await findUnit();
      const late = bin || resolved || label ? null : await findBin();
      const shelf = bin ?? late;
      if (shelf) {
        if (from === null) setFrom(shelf);
        else setTo(shelf);
      } else if (resolved) {
        setItem({
          productUnitId: resolved.unit.id,
          productName: resolved.product.name,
          unitName: resolved.unit.uomName,
        });
      } else {
        setMissing(code);
      }
    });
  }

  const canAdd = from !== null && to !== null && item !== null && isQty(qty) && from.id !== to.id;
  const addLine = () => {
    if (!canAdd) return;
    setLines((previous) => [...previous, { ...item, enteredQty: qty, from, to }]);
    setItem(null);
    setTo(null);
    setQty('1');
  };

  const submit = () =>
    void action.run(async () => {
      const move = await mutations.createMove.mutateAsync({
        key,
        warehouseId,
        lines: lines.map((line) => ({
          productUnitId: line.productUnitId,
          enteredQty: line.enteredQty,
          fromBinId: line.from.id,
          toBinId: line.to.id,
        })),
      });
      setKey(randomUuid());
      reset();
      toast.success(t('inventory.moves.done', { number: move.number }));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.moves.create')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('inventory.moves.hint')}</p>
        <ScanBox
          letters
          label={t('inventory.scanLabel')}
          placeholder={t('inventory.scanPlaceholder')}
          onScan={onScan}
        />
        {missing ? (
          <p className="text-sm text-destructive">
            {t('inventory.scanNotFound', { code: missing })}
          </p>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label>{t('inventory.moves.from')}</Label>
            <span className="font-mono text-sm">{from?.code ?? t('inventory.moves.pickFrom')}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('inventory.product')}</Label>
            <span className="text-sm">
              {item
                ? t('inventory.productUnit', { product: item.productName, unit: item.unitName })
                : t('inventory.moves.pickProduct')}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="move-qty">{t('inventory.qty')}</Label>
            <Input
              id="move-qty"
              inputMode="decimal"
              autoComplete="off"
              className="w-28 font-mono"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              onKeyDown={(event) => guard(event, qty, setQty)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('inventory.moves.to')}</Label>
            <span className="font-mono text-sm">{to?.code ?? t('inventory.moves.pickTo')}</span>
          </div>
        </div>
        <ProductSearch
          onPick={(product) =>
            setItem({
              productUnitId: product.baseUnit.id,
              productName: product.name,
              unitName: product.baseUnit.uomName,
            })
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canAdd} onClick={addLine}>
            {t('inventory.moves.addLine')}
          </Button>
          <Button variant="ghost" onClick={reset}>
            {t('inventory.moves.reset')}
          </Button>
        </div>
        {lines.length > 0 ? (
          <>
            <Label>{t('inventory.moves.pending')}</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.product')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                  <TableHead>{t('inventory.moves.from')}</TableHead>
                  <TableHead>{t('inventory.moves.to')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={`${line.productUnitId}:${line.from.id}:${line.to.id}:${index}`}>
                    <TableCell className="whitespace-normal">{line.productName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', { qty: line.enteredQty, unit: line.unitName })}
                    </TableCell>
                    <TableCell className="font-mono">{line.from.code}</TableCell>
                    <TableCell className="font-mono">{line.to.code}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          setLines((previous) => previous.filter((_, other) => other !== index))
                        }
                      >
                        {t('inventory.remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              className="self-start"
              disabled={mutations.createMove.isPending}
              onClick={submit}
            >
              {t('inventory.moves.submit')}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
