import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { type Bin, type BinRangeResult, useBins, useInventoryMutations } from './api';
import { type RangeForm, rangeNumbers, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const SHELF_TYPES = ['STORAGE', 'PICKING'] as const;
type ShelfType = (typeof SHELF_TYPES)[number];
/**
 * Shelves of a warehouse (owner, 2026-10-11: numbered shelves with barcode labels "A-01-03", 300
 * and more per warehouse): one at a time or a whole range with a preview first. System bins are
 * made by the system; a used shelf is archived, an unused one may be deleted.
 */
export function BinsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [archived, setArchived] = useState(false);
  const warehouses = useWarehouseOptions(SHELF_KINDS, true);
  const bins = useBins({ warehouseId, q, archived });
  const rows = bins.data?.pages.flatMap((page) => page.data) ?? [];
  const mutations = useInventoryMutations();
  const action = useAction();
  const [deleting, setDeleting] = useState<Bin | null>(null);

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
    <div className="flex flex-col gap-4">
      <PageHeader title={t('inventory.bins.title')} />
      <WarehouseSelect
        className="max-w-xs"
        options={warehouses.options}
        value={warehouseId}
        emptyLabel={t('inventory.pickWarehouse')}
        onChange={setWarehouse}
      />
      {warehouseId === undefined ? null : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <BinCreateCard key={`one-${warehouseId}`} warehouseId={warehouseId} />
            <BinRangeCard key={`range-${warehouseId}`} warehouseId={warehouseId} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              type="search"
              aria-label={t('common.search')}
              placeholder={t('inventory.bins.searchPlaceholder')}
              className="max-w-xs font-mono"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="bins-archived"
                checked={archived}
                onCheckedChange={(checked) => setArchived(checked === true)}
              />
              <Label htmlFor="bins-archived">{t('inventory.bins.showArchived')}</Label>
            </div>
          </div>
          <ProblemAlert
            problem={deleting ? null : (action.problem ?? problemFromError(bins.error))}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.bins.code')}</TableHead>
                <TableHead>{t('inventory.bins.type')}</TableHead>
                <TableHead>{t('inventory.bins.name')}</TableHead>
                <TableHead>{t('inventory.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((bin) => (
                <TableRow key={bin.id}>
                  <TableCell className="font-mono">{bin.code}</TableCell>
                  <TableCell>{t(`inventory.binTypes.${bin.type}`)}</TableCell>
                  <TableCell>{bin.name ?? t('common.none')}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    <Badge variant={bin.status === 'ACTIVE' ? 'secondary' : 'default'}>
                      {t(`inventory.binStatus.${bin.status}`)}
                    </Badge>
                    {bin.isSystem ? (
                      <Badge variant="outline">{t('inventory.bins.system')}</Badge>
                    ) : null}
                    {bin.archivedAt ? (
                      <Badge variant="outline">{t('inventory.bins.archived')}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {bin.isSystem ? null : (
                      <span className="flex justify-end gap-1">
                        {bin.archivedAt ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              void action.run(() => mutations.restoreBin.mutateAsync(bin.id))
                            }
                          >
                            {t('inventory.bins.restore')}
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              void action.run(() => mutations.archiveBin.mutateAsync(bin.id))
                            }
                          >
                            {t('inventory.bins.archive')}
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            action.clear();
                            setDeleting(bin);
                          }}
                        >
                          {t('inventory.bins.delete')}
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!bins.isPending && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.bins.empty')}</p>
          ) : null}
          {bins.hasNextPage ? (
            <Button
              className="self-start"
              variant="outline"
              disabled={bins.isFetchingNextPage}
              onClick={() => void bins.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('inventory.bins.deleteTitle', { code: deleting?.code ?? '' })}
        confirmLabel={t('inventory.bins.delete')}
        pending={mutations.deleteBin.isPending}
        problem={action.problem}
        onConfirm={() =>
          void action.run(async () => {
            if (deleting) await mutations.deleteBin.mutateAsync(deleting.id);
            setDeleting(null);
          })
        }
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function ShelfTypeSelect(props: { value: ShelfType; onChange: (type: ShelfType) => void }) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      aria-label={t('inventory.bins.type')}
      value={props.value}
      onChange={(event) => {
        const picked = SHELF_TYPES.find((type) => type === event.target.value);
        if (picked) props.onChange(picked);
      }}
    >
      {SHELF_TYPES.map((type) => (
        <option key={type} value={type}>
          {t(`inventory.binTypes.${type}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

function BinCreateCard({ warehouseId }: { warehouseId: number }) {
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const action = useAction();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ShelfType>('STORAGE');

  const create = () =>
    void action.run(async () => {
      await mutations.createBin.mutateAsync({
        warehouseId,
        code: code.trim(),
        type,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setCode('');
      setName('');
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.bins.createTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            aria-label={t('inventory.bins.code')}
            placeholder={t('inventory.bins.codePlaceholder')}
            className="font-mono"
            maxLength={32}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <ShelfTypeSelect value={type} onChange={setType} />
          <Input
            aria-label={t('inventory.bins.name')}
            placeholder={t('inventory.bins.name')}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button
          className="self-start"
          disabled={!code.trim() || mutations.createBin.isPending}
          onClick={create}
        >
          {t('inventory.add')}
        </Button>
      </CardContent>
    </Card>
  );
}

function BinRangeCard({ warehouseId }: { warehouseId: number }) {
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const action = useAction();
  const [type, setType] = useState<ShelfType>('STORAGE');
  const [form, setForm] = useState<RangeForm>({
    rowFrom: 'A',
    rowTo: 'A',
    rackFrom: '1',
    rackTo: '10',
    levelFrom: '1',
    levelTo: '3',
  });
  const [preview, setPreview] = useState<BinRangeResult | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const numbers = rangeNumbers(form);
  const field = (key: keyof RangeForm, label: string) => (
    <Input
      aria-label={label}
      className="w-20 font-mono"
      value={form[key]}
      onChange={(event) => {
        setPreview(null);
        setCreated(null);
        setForm((previous) => ({ ...previous, [key]: event.target.value }));
      }}
    />
  );

  const run = (dryRun: boolean) =>
    void action.run(async () => {
      if (!numbers) return;
      const result = await mutations.createBinRange.mutateAsync({
        warehouseId,
        type,
        ...numbers,
        dryRun,
      });
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        setCreated(result.created);
      }
    });

  const fresh = preview ? preview.codes.length - preview.existing.length : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.bins.rangeTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('inventory.bins.rangeHint')}</p>
        <ProblemAlert problem={action.problem} />
        <div className="grid grid-cols-[auto_auto_auto] items-center gap-2 text-sm">
          <Label>{t('inventory.bins.rows')}</Label>
          {field('rowFrom', `${t('inventory.bins.rows')} ${t('inventory.bins.from')}`)}
          {field('rowTo', `${t('inventory.bins.rows')} ${t('inventory.bins.to')}`)}
          <Label>{t('inventory.bins.racks')}</Label>
          {field('rackFrom', `${t('inventory.bins.racks')} ${t('inventory.bins.from')}`)}
          {field('rackTo', `${t('inventory.bins.racks')} ${t('inventory.bins.to')}`)}
          <Label>{t('inventory.bins.levels')}</Label>
          {field('levelFrom', `${t('inventory.bins.levels')} ${t('inventory.bins.from')}`)}
          {field('levelTo', `${t('inventory.bins.levels')} ${t('inventory.bins.to')}`)}
        </div>
        <ShelfTypeSelect
          value={type}
          onChange={(next) => {
            setPreview(null);
            setType(next);
          }}
        />
        {preview && preview.codes.length > 0 ? (
          <p className="text-sm">
            {t('inventory.bins.previewResult', {
              count: preview.codes.length,
              first: preview.codes[0] ?? '',
              last: preview.codes[preview.codes.length - 1] ?? '',
            })}
            {preview.existing.length > 0
              ? `; ${t('inventory.bins.previewExisting', { count: preview.existing.length })}`
              : ''}
          </p>
        ) : null}
        {created !== null ? (
          <p className="text-sm text-emerald-700">
            {t('inventory.bins.created', { count: created })}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!numbers || mutations.createBinRange.isPending}
            onClick={() => run(true)}
          >
            {t('inventory.bins.preview')}
          </Button>
          <Button
            disabled={!preview || fresh === 0 || mutations.createBinRange.isPending}
            onClick={() => run(false)}
          >
            {t('inventory.bins.createRange')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
