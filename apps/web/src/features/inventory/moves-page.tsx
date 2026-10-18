import { Move, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LeaveGuard } from '@/components/leave-guard';
import {
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
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
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type Bin, useBinLookup, useBinMoves, useInventoryMutations } from './api';
import { isQty, looksLikeLabel, useWarehouseName, useWarehouseOptions } from './helpers';
import { ProductSearch, ScanToolbar, WarehouseSelect } from './shared';

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

/**
 * Bin moves (BM-): put-away from the receiving area and shelf-to-shelf moves, posted at once. The
 * form comes first and the moves made follow it under their own title (docs/ui.md: never a create
 * form above its list); lines not moved yet are asked about before the page or the warehouse
 * changes.
 */
export function BinMovesPage() {
  const { t } = useTranslation();
  const canMove = useHasPermission('inventory.moves.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const warehouses = useWarehouseOptions(SHELF_KINDS, canMove);
  const warehouseName = useWarehouseName();
  const moves = useBinMoves({ warehouseId });
  const rows = moves.data?.pages.flatMap((page) => page.data) ?? [];

  // Lines added in the form and not moved yet: a warehouse change asks first.
  const [pending, setPending] = useState(0);
  const [switching, setSwitching] = useState<{ id: number | undefined } | null>(null);

  const setWarehouse = (id: number | undefined) =>
    setParam('warehouseId', id === undefined ? null : String(id));
  const chooseWarehouse = (id: number | undefined) => {
    if (pending > 0) setSwitching({ id });
    else setWarehouse(id);
  };

  return (
    <div>
      <PageHeader title={t('inventory.moves.title')} />
      <FilterBar>
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={canMove ? t('inventory.pickWarehouse') : t('inventory.allWarehouses')}
          onChange={chooseWarehouse}
        />
      </FilterBar>
      {canMove && warehouseId !== undefined ? (
        <div className="mb-6">
          <MoveForm key={warehouseId} warehouseId={warehouseId} onPending={setPending} />
        </div>
      ) : null}
      <h2 className="mb-2 text-[15px] font-semibold tracking-tight">
        {t('inventory.moves.history')}
      </h2>
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
      <LeaveGuard
        when={pending > 0}
        title={t('inventory.moves.leaveTitle')}
        description={t('inventory.moves.leaveDescription')}
        leaveLabel={t('inventory.moves.leave')}
      />
      <ConfirmDialog
        open={switching !== null}
        title={t('inventory.moves.leaveTitle')}
        description={t('inventory.moves.leaveDescription')}
        confirmLabel={t('inventory.moves.leave')}
        onConfirm={() => {
          if (switching) setWarehouse(switching.id);
          setSwitching(null);
        }}
        onClose={() => setSwitching(null)}
      />
    </div>
  );
}

/**
 * Scan the shelf goods leave, the product and its quantity, then the shelf they go to; repeat,
 * then move them all in one document. A label scan fills "from" first, then "to".
 */
function MoveForm({
  warehouseId,
  onPending,
}: {
  warehouseId: number;
  /** How many lines wait to be moved (the page asks before dropping them). */
  onPending: (count: number) => void;
}) {
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
  useEffect(() => onPending(lines.length), [lines.length, onPending]);
  useEffect(() => () => onPending(0), [onPending]);

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
        <p className="text-[13px] text-muted-foreground">{t('inventory.moves.hint')}</p>
        <ScanToolbar
          scanBox={
            <ScanBox
              letters
              label={t('inventory.scanLabel')}
              placeholder={t('inventory.scanPlaceholder')}
              onScan={onScan}
            />
          }
          search={
            <ProductSearch
              onScan={onScan}
              onPick={(product) =>
                setItem({
                  productUnitId: product.baseUnit.id,
                  productName: product.name,
                  unitName: product.baseUnit.uomName,
                })
              }
            />
          }
          status={
            missing ? (
              <span className="text-destructive">
                {t('inventory.scanNotFound', { code: missing })}
              </span>
            ) : null
          }
        />
        <ProblemAlert problem={action.problem} />
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Picked term={t('inventory.moves.from')} mono>
            {from?.code ?? t('inventory.moves.pickFrom')}
          </Picked>
          <Picked term={t('inventory.product')}>
            {item
              ? t('inventory.productUnit', { product: item.productName, unit: item.unitName })
              : t('inventory.moves.pickProduct')}
          </Picked>
          <div className="flex flex-col gap-1.5">
            <dt>
              <Label htmlFor="move-qty">{t('inventory.qty')}</Label>
            </dt>
            <dd>
              <Input
                id="move-qty"
                inputMode="decimal"
                autoComplete="off"
                className="w-28 font-mono"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                onKeyDown={(event) => guard(event, qty, setQty)}
              />
            </dd>
          </div>
          <Picked term={t('inventory.moves.to')} mono>
            {to?.code ?? t('inventory.moves.pickTo')}
          </Picked>
        </dl>
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
            <h3 className="text-sm font-medium">{t('inventory.moves.pending')}</h3>
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
                      {t('inventory.qtyWithUnit', {
                        qty: formatQty(line.enteredQty),
                        unit: line.unitName,
                      })}
                    </TableCell>
                    <TableCell className="font-mono">{line.from.code}</TableCell>
                    <TableCell className="font-mono">{line.to.code}</TableCell>
                    <RowActions>
                      <RowAction
                        label={`${t('inventory.remove')}: ${line.productName}`}
                        icon={Trash2}
                        destructive
                        onClick={() =>
                          setLines((previous) => previous.filter((_, other) => other !== index))
                        }
                      />
                    </RowActions>
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

/** A step the scans fill (the shelves, the product): a term over its value, read only. */
function Picked(props: { term: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm leading-none font-medium">{props.term}</dt>
      <dd className={cn('text-sm', props.mono ? 'font-mono' : null)}>{props.children}</dd>
    </div>
  );
}
