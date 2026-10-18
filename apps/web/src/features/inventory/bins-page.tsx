import { Archive, ArchiveRestore, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  RowActionSpacer,
  SearchField,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { toast } from '@/lib/toast';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { type Bin, type BinRangeResult, useBins, useInventoryMutations } from './api';
import { type RangeForm, rangeNumbers, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const SHELF_TYPES = ['STORAGE', 'PICKING'] as const;
type ShelfType = (typeof SHELF_TYPES)[number];
const MODES = ['one', 'range'] as const;
type Mode = (typeof MODES)[number];

/**
 * Shelves of a warehouse (owner, 2026-10-11: numbered shelves with barcode labels "A-01-03", 300
 * and more per warehouse). «Тавиур нэмэх» opens a dialog: one shelf, or a whole range with a
 * preview first (ADR-0042: never a create form above the list). System bins are made by the
 * system; a used shelf is archived, an unused one may be deleted.
 */
export function BinsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  // The filters live in the URL (ADR-0066): a reload or a shared link keeps them.
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const archived = params.get('archived') === '1';
  const warehouses = useWarehouseOptions(SHELF_KINDS, true);
  const bins = useBins({ warehouseId, q, archived });
  const rows = bins.data?.pages.flatMap((page) => page.data) ?? [];
  const mutations = useInventoryMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const deletion = useDeleteConfirm<Bin>((id) => mutations.deleteBin.mutateAsync(id));

  const setWarehouse = (id: number | undefined) =>
    setParam('warehouseId', id === undefined ? null : String(id));

  return (
    <div>
      <PageHeader
        title={t('inventory.bins.title')}
        actions={
          warehouseId === undefined ? null : (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('inventory.bins.createTitle')}
            </Button>
          )
        }
      />
      {warehouseId !== undefined ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? (
            <BinCreateDialog warehouseId={warehouseId} onClose={() => setCreating(false)} />
          ) : null}
        </Dialog>
      ) : null}
      <FilterBar>
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.pickWarehouse')}
          onChange={setWarehouse}
        />
        {warehouseId === undefined ? null : (
          <>
            <SearchField
              aria-label={t('common.search')}
              placeholder={t('inventory.bins.searchPlaceholder')}
              className="font-mono"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setParam('q', event.target.value.trim());
              }}
            />
            <FilterToggle
              label={t('inventory.bins.showArchived')}
              checked={archived}
              onCheckedChange={(checked) => setParam('archived', checked ? '1' : null)}
            />
          </>
        )}
      </FilterBar>
      {warehouseId === undefined ? null : (
        <>
          <ProblemAlert problem={action.problem ?? problemFromError(bins.error)} />
          <ListCard scroll>
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
                {bins.isPending ? <SkeletonRows columns={5} /> : null}
                {rows.map((bin) => (
                  <TableRow key={bin.id}>
                    <TableCell className="font-mono">{bin.code}</TableCell>
                    <TableCell>{t(`inventory.binTypes.${bin.type}`)}</TableCell>
                    <TableCell>{bin.name ?? t('common.none')}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {/* Only the exception is marked: a shelf being counted, blue as a document in progress. */}
                        {bin.status === 'ACTIVE' ? null : (
                          <Badge variant="default">{t(`inventory.binStatus.${bin.status}`)}</Badge>
                        )}
                        {bin.isSystem ? (
                          <Badge variant="outline">{t('inventory.bins.system')}</Badge>
                        ) : null}
                        {bin.archivedAt ? (
                          <Badge variant="outline">{t('inventory.bins.archived')}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <RowActions>
                      {bin.isSystem ? (
                        <>
                          <RowActionSpacer />
                          <RowActionSpacer />
                        </>
                      ) : (
                        <>
                          {bin.archivedAt ? (
                            <RowAction
                              label={`${t('inventory.bins.restore')}: ${bin.code}`}
                              icon={ArchiveRestore}
                              onClick={() =>
                                void action.run(() => mutations.restoreBin.mutateAsync(bin.id))
                              }
                            />
                          ) : (
                            <RowAction
                              label={`${t('inventory.bins.archive')}: ${bin.code}`}
                              icon={Archive}
                              onClick={() =>
                                void action.run(() => mutations.archiveBin.mutateAsync(bin.id))
                              }
                            />
                          )}
                          <RowAction
                            label={`${t('inventory.bins.delete')}: ${bin.code}`}
                            icon={Trash2}
                            destructive
                            onClick={() => {
                              action.clear();
                              deletion.ask(bin);
                            }}
                          />
                        </>
                      )}
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!bins.isPending && rows.length === 0 ? (
              <EmptyState icon={LayoutGrid} title={t('inventory.bins.empty')} />
            ) : null}
            <LoadMore query={bins} />
          </ListCard>
        </>
      )}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('inventory.bins.deleteTitle', { code: deletion.target?.code ?? '' })}
        confirmLabel={t('inventory.bins.delete')}
        pending={deletion.pending}
        problem={deletion.problem}
        onConfirm={deletion.confirm}
        onClose={deletion.close}
      />
    </div>
  );
}

function ShelfTypeSelect(props: {
  id: string;
  value: ShelfType;
  onChange: (type: ShelfType) => void;
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      id={props.id}
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

/**
 * New shelves of the chosen warehouse: one (the dialog stays open for the next code, ADR-0042
 * "forms filled many times in a row") or a whole range previewed first.
 */
function BinCreateDialog({ warehouseId, onClose }: { warehouseId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('one');
  return (
    <DialogContent
      closeLabel={t('common.close')}
      size="md"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById('bin-code')?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('inventory.bins.createTitle')}</DialogTitle>
        <DialogDescription>
          {mode === 'one' ? t('inventory.bins.oneHint') : t('inventory.bins.rangeHint')}
        </DialogDescription>
      </DialogHeader>
      <div>
        <SegmentedControl
          options={MODES}
          value={mode}
          label={(value) =>
            value === 'one' ? t('inventory.bins.modeOne') : t('inventory.bins.rangeTitle')
          }
          onChange={setMode}
        />
      </div>
      {mode === 'one' ? (
        <OneShelfForm warehouseId={warehouseId} onClose={onClose} />
      ) : (
        <ShelfRangeForm warehouseId={warehouseId} onClose={onClose} />
      )}
    </DialogContent>
  );
}

function OneShelfForm({ warehouseId, onClose }: { warehouseId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const action = useAction();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ShelfType>('STORAGE');
  const [added, setAdded] = useState<string | null>(null);

  const create = () =>
    void action.run(async () => {
      const created = await mutations.createBin.mutateAsync({
        warehouseId,
        code: code.trim(),
        type,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setAdded(created.code);
      setCode('');
      setName('');
      document.getElementById('bin-code')?.focus();
    });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() && !mutations.createBin.isPending) create();
      }}
    >
      {added ? (
        <p aria-live="polite" className="text-sm font-medium text-success">
          {t('inventory.bins.createdOne', { code: added })}
        </p>
      ) : null}
      <ProblemAlert problem={action.problem} />
      <FormField label={t('inventory.bins.code')} htmlFor="bin-code">
        <Input
          id="bin-code"
          placeholder={t('inventory.bins.codePlaceholder')}
          className="font-mono sm:w-44"
          autoComplete="off"
          maxLength={32}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </FormField>
      <FormField label={t('inventory.bins.type')} htmlFor="bin-type">
        <ShelfTypeSelect id="bin-type" value={type} onChange={setType} />
      </FormField>
      <FormField label={t('inventory.bins.name')} htmlFor="bin-name">
        <Input
          id="bin-name"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button type="submit" disabled={!code.trim() || mutations.createBin.isPending}>
          {t('inventory.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ShelfRangeForm({ warehouseId, onClose }: { warehouseId: number; onClose: () => void }) {
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
  const numbers = rangeNumbers(form);
  const field = (key: keyof RangeForm, label: string) => (
    <Input
      aria-label={label}
      className="w-20 font-mono"
      value={form[key]}
      onChange={(event) => {
        setPreview(null);
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
        toast.success(t('inventory.bins.created', { count: result.created }));
        onClose();
      }
    });

  const fresh = preview ? preview.codes.length - preview.existing.length : 0;
  return (
    <div className="space-y-4">
      <ProblemAlert problem={action.problem} />
      <div className="grid grid-cols-[auto_auto_auto] items-center justify-start gap-2 text-sm">
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
      <FormField label={t('inventory.bins.type')} htmlFor="bin-range-type">
        <ShelfTypeSelect
          id="bin-range-type"
          value={type}
          onChange={(next) => {
            setPreview(null);
            setType(next);
          }}
        />
      </FormField>
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!numbers || mutations.createBinRange.isPending}
          onClick={() => run(true)}
        >
          {t('inventory.bins.preview')}
        </Button>
        <Button
          type="button"
          disabled={!preview || fresh === 0 || mutations.createBinRange.isPending}
          onClick={() => run(false)}
        >
          {t('inventory.bins.createRange')}
        </Button>
      </DialogFooter>
    </div>
  );
}
