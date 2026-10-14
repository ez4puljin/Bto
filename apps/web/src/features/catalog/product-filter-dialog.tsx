import { useDeferredValue, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FormField } from '@/components/form';
import { SearchField, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
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
import { useWarehouses } from '@/features/identity/api';
import { useSuppliers, useSuppliersByIds } from '@/features/partners/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { useSegments } from '@/features/segments/api';
import {
  DATE_PRESETS,
  type DateFilter,
  MISSING_CHOICES,
  type MissingChoice,
  missingLabelKey,
  priceIssue,
  type ProductFilterField,
  type ProductFilters,
  STOCK_KINDS,
  type StockKind,
  withFilter,
} from './product-filters';

/** Warehouses that sell: the ones homes, stock and minimums are kept for (ADR-0049). */
const SELLING_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];

interface EditorProps {
  filters: ProductFilters;
  /** Applies the filters with this dialog's field changed. */
  apply: (next: ProductFilters) => void;
  close: () => void;
}

/**
 * One filter of the product list (ADR-0049): opened from «Шүүлтүүр» or a chip, filled with the
 * field's current value. «Шүүх» applies it; choosing nothing removes it.
 */
export function ProductFilterDialog(props: EditorProps & { field: ProductFilterField }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.close())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`catalog.products.filters.fields.${props.field}`)}</DialogTitle>
          <DialogDescription>{t('catalog.products.filters.hint')}</DialogDescription>
        </DialogHeader>
        <FieldEditor {...props} />
      </DialogContent>
    </Dialog>
  );
}

function FieldEditor(props: EditorProps & { field: ProductFilterField }) {
  switch (props.field) {
    case 'segment':
      return <SegmentEditor {...props} />;
    case 'supplier':
      return <SupplierEditor {...props} />;
    case 'home':
      return <WarehousesEditor {...props} />;
    case 'profile':
      return <ProfilesEditor {...props} />;
    case 'price':
      return <PriceEditor {...props} />;
    case 'stock':
      return <StockEditor {...props} />;
    case 'created':
    case 'updated':
      return <DateEditor {...props} field={props.field} />;
    case 'missing':
      return <MissingEditor {...props} />;
  }
}

/** The dialog's form: the field, a problem if any, «Болих» and «Шүүх». */
function FilterForm(props: {
  onSubmit: () => void;
  close: () => void;
  problem?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {props.children}
      {props.problem ? (
        <p role="alert" className="text-sm text-destructive">
          {props.problem}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.close}>
          {t('common.cancel')}
        </Button>
        <Button type="submit">{t('catalog.products.filters.apply')}</Button>
      </DialogFooter>
    </form>
  );
}

/** A scrolling box of checkboxes, for lists longer than a few lines. */
function ChoiceList(props: { children: ReactNode }) {
  return <div className="max-h-64 overflow-y-auto rounded-lg border p-3">{props.children}</div>;
}

function Loading() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
}

function SegmentEditor({ filters, apply, close }: EditorProps) {
  const { t } = useTranslation();
  const canManage = useHasPermission('segments.manage');
  const segments = useSegments('PRODUCT');
  const [segment, setSegment] = useState(filters.segment);
  const rows = segments.data;
  return (
    <FilterForm close={close} onSubmit={() => apply(withFilter(filters, 'segment', segment))}>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.filters.noSegments')}{' '}
          {canManage ? (
            <Link className="text-link" to="/segments/new?entity=PRODUCT">
              {t('segments.create')}
            </Link>
          ) : null}
        </p>
      ) : (
        <FormField label={t('catalog.products.filters.fields.segment')} htmlFor="filter-segment">
          <NativeSelect
            id="filter-segment"
            value={segment === undefined ? '' : String(segment)}
            onChange={(event) =>
              setSegment(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
            }
          >
            <option value="">{t('catalog.products.filters.chooseSegment')}</option>
            {rows.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}
    </FilterForm>
  );
}

function SupplierEditor({ filters, apply, close }: EditorProps) {
  const { t } = useTranslation();
  const [main, setMain] = useState(filters.supplier?.main ?? false);
  const [ids, setIds] = useState<number[]>(filters.supplier?.ids ?? []);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useSuppliers({ q }, { limit: 20 });
  // The suppliers chosen when the dialog opened stay listed while the search shows others.
  const [initial] = useState(ids);
  const chosen = useSuppliersByIds(initial);
  const options = new Map<number, string>();
  for (const row of [...(chosen.data ?? []), ...(found.data?.pages[0]?.data ?? [])]) {
    options.set(row.id, row.name);
  }
  return (
    <FilterForm
      close={close}
      onSubmit={() =>
        apply(withFilter(filters, 'supplier', ids.length > 0 ? { main, ids } : undefined))
      }
    >
      <SegmentedControl
        options={['IN', 'MAIN_IN'] as const}
        value={main ? 'MAIN_IN' : 'IN'}
        label={(mode) => t(`catalog.products.filters.supplierModes.${mode}`)}
        onChange={(mode) => setMain(mode === 'MAIN_IN')}
      />
      <SearchField
        className="sm:w-full"
        aria-label={t('catalog.products.filters.searchSupplier')}
        placeholder={t('catalog.products.filters.searchSupplier')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ChoiceList>
        {options.size === 0 ? (
          found.isPending ? (
            <Loading />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('catalog.products.filters.noMatches')}
            </p>
          )
        ) : (
          <CheckboxGroup
            name="filter-supplier"
            options={[...options].map(([value, label]) => ({ value, label }))}
            value={ids}
            onChange={setIds}
          />
        )}
      </ChoiceList>
    </FilterForm>
  );
}

function WarehousesEditor({ filters, apply, close }: EditorProps) {
  const warehouses = useWarehouses();
  const [ids, setIds] = useState<number[]>(filters.home ?? []);
  const rows = (warehouses.data ?? []).filter((row) => SELLING_KINDS.includes(row.kind));
  return (
    <FilterForm
      close={close}
      onSubmit={() => apply(withFilter(filters, 'home', ids.length > 0 ? ids : undefined))}
    >
      {warehouses.data ? (
        <ChoiceList>
          <CheckboxGroup
            name="filter-home"
            options={rows.map((row) => ({ value: row.id, label: row.name }))}
            value={ids}
            onChange={setIds}
          />
        </ChoiceList>
      ) : (
        <Loading />
      )}
    </FilterForm>
  );
}

function ProfilesEditor({ filters, apply, close }: EditorProps) {
  const profiles = usePriceProfileChoices();
  const [ids, setIds] = useState<number[]>(filters.profile ?? []);
  return (
    <FilterForm
      close={close}
      onSubmit={() => apply(withFilter(filters, 'profile', ids.length > 0 ? ids : undefined))}
    >
      {profiles.data ? (
        <ChoiceList>
          <CheckboxGroup
            name="filter-profile"
            options={profiles.data.map((row) => ({ value: row.id, label: row.name }))}
            value={ids}
            onChange={setIds}
          />
        </ChoiceList>
      ) : (
        <Loading />
      )}
    </FilterForm>
  );
}

function PriceEditor({ filters, apply, close }: EditorProps) {
  const { t } = useTranslation();
  const [min, setMin] = useState(filters.price?.min ?? '');
  const [max, setMax] = useState(filters.price?.max ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const low = min.replace(/[\s,]/g, '');
    const high = max.replace(/[\s,]/g, '');
    const issue = low || high ? priceIssue(low, high) : null;
    if (issue) {
      setProblem(t(`segments.issues.${issue}`));
    } else {
      const range = { ...(low ? { min: low } : {}), ...(high ? { max: high } : {}) };
      apply(withFilter(filters, 'price', low || high ? range : undefined));
    }
  };
  return (
    <FilterForm close={close} onSubmit={submit} problem={problem}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('catalog.products.filters.minPrice')} htmlFor="filter-price-min">
          <Input
            id="filter-price-min"
            inputMode="numeric"
            className="font-mono"
            value={min}
            onChange={(event) => setMin(event.target.value)}
          />
        </FormField>
        <FormField label={t('catalog.products.filters.maxPrice')} htmlFor="filter-price-max">
          <Input
            id="filter-price-max"
            inputMode="numeric"
            className="font-mono"
            value={max}
            onChange={(event) => setMax(event.target.value)}
          />
        </FormField>
      </div>
    </FilterForm>
  );
}

function StockEditor({ filters, apply, close }: EditorProps) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const [kind, setKind] = useState<StockKind>(filters.stock?.kind ?? 'in');
  const [warehouseId, setWarehouseId] = useState(filters.stock?.warehouseId);
  const rows = (warehouses.data ?? []).filter((row) => SELLING_KINDS.includes(row.kind));
  return (
    <FilterForm
      close={close}
      onSubmit={() =>
        apply(withFilter(filters, 'stock', { kind, ...(warehouseId ? { warehouseId } : {}) }))
      }
    >
      <SegmentedControl
        options={STOCK_KINDS}
        value={kind}
        label={(value) => t(`catalog.products.filters.stockKinds.${value}`)}
        onChange={setKind}
      />
      <FormField label={t('catalog.products.filters.warehouse')} htmlFor="filter-stock-warehouse">
        <NativeSelect
          id="filter-stock-warehouse"
          value={warehouseId === undefined ? '' : String(warehouseId)}
          onChange={(event) =>
            setWarehouseId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
          }
        >
          <option value="">{t('catalog.products.filters.allSellingWarehouses')}</option>
          {rows.map((row) => (
            <option key={row.id} value={String(row.id)}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </FilterForm>
  );
}

const DATE_CHOICES = ['1', '7', '30', 'range'] as const;
type DateChoice = (typeof DATE_CHOICES)[number];

function DateEditor(props: EditorProps & { field: 'created' | 'updated' }) {
  const { t } = useTranslation();
  const { filters, apply, close, field } = props;
  const current: DateFilter | undefined = filters[field];
  const preset =
    current && 'days' in current && DATE_PRESETS.some((days) => days === current.days)
      ? (String(current.days) as DateChoice)
      : current
        ? 'range'
        : '30';
  const [choice, setChoice] = useState<DateChoice>(preset);
  const [from, setFrom] = useState(current && 'from' in current ? (current.from ?? '') : '');
  const [to, setTo] = useState(current && 'to' in current ? (current.to ?? '') : '');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    if (choice !== 'range') {
      apply(withFilter(filters, field, { days: Number.parseInt(choice, 10) }));
    } else if (from && to && from > to) {
      setProblem(t('segments.issues.DATE_ORDER'));
    } else {
      const range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
      apply(withFilter(filters, field, from || to ? range : undefined));
    }
  };
  return (
    <FilterForm close={close} onSubmit={submit} problem={problem}>
      <SegmentedControl
        options={DATE_CHOICES}
        value={choice}
        label={(value) => t(`catalog.products.filters.datePresets.${value}`)}
        onChange={setChoice}
      />
      {choice === 'range' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('catalog.products.filters.from')} htmlFor={`filter-${field}-from`}>
            <Input
              id={`filter-${field}-from`}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </FormField>
          <FormField label={t('catalog.products.filters.to')} htmlFor={`filter-${field}-to`}>
            <Input
              id={`filter-${field}-to`}
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </FormField>
        </div>
      ) : null}
    </FilterForm>
  );
}

function MissingEditor({ filters, apply, close }: EditorProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<MissingChoice[]>(filters.missing ?? []);
  return (
    <FilterForm
      close={close}
      onSubmit={() =>
        apply(
          withFilter(
            filters,
            'missing',
            chosen.length > 0
              ? MISSING_CHOICES.filter((choice) => chosen.includes(choice))
              : undefined,
          ),
        )
      }
    >
      <CheckboxGroup
        name="filter-missing"
        options={MISSING_CHOICES.map((choice) => ({
          value: choice,
          label: t(missingLabelKey(choice)),
        }))}
        value={chosen}
        onChange={setChosen}
      />
    </FilterForm>
  );
}
