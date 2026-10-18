import { MAX_BULK_PRODUCTS } from '@tugeel/shared/catalog';
import { businessDate } from '@tugeel/shared/time';
import { ChevronDown, Pencil } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWarehouses } from '@/features/identity/api';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { formatCount } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type ProductListItem, useCategories, useProductNames } from './api';
import { useBulkEdits } from './bulk-api';
import { categoryTree } from './category-tree';

type EditAction = 'category' | 'mainSupplier' | 'profile' | 'home';
type StatusAction = 'deactivate' | 'activate';

/** How many to name before «+N» in a list of products. */
const NAMED = 5;

/** A toast saying what a bulk change did: changed, already so, skipped without terms. */
function useReport() {
  const { t } = useTranslation();
  return (result: { changed: number[]; unchanged: number[]; skipped?: unknown[] }) => {
    const parts: string[] = [];
    if (result.changed.length > 0 || (result.unchanged.length === 0 && !result.skipped?.length)) {
      parts.push(t('catalog.products.bulk.done', { count: formatCount(result.changed.length) }));
    }
    if (result.unchanged.length > 0) {
      parts.push(t('catalog.products.bulk.same', { count: formatCount(result.unchanged.length) }));
    }
    if (result.skipped?.length) {
      parts.push(t('catalog.products.bulk.noTerms', { count: formatCount(result.skipped.length) }));
    }
    toast.success(parts.join('. '));
  };
}

/**
 * The selection bar's changes of the ticked products (ADR-0051 #3, ADR-0052): «Засах» (category,
 * main supplier, price profile, home warehouse, then «Идэвхгүй болгох» and «Идэвхжүүлэх»), each
 * shown to those holding its right. They act on every ticked product, loaded or not; the ticks of
 * other searches have unknown statuses, so both status changes are offered and the server says
 * which already were so. Every change opens a dialog naming the count (above 500 it only says
 * so); afterwards a toast says what changed and the ticks clear.
 */
export function BulkActions(props: {
  /** Every ticked product. */
  ids: readonly number[];
  /** The ticked rows the list has loaded: their names. */
  rows: readonly ProductListItem[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const canProducts = useHasPermission('catalog.products.manage');
  const canSuppliers = useHasPermission('partners.suppliers.manage');
  const canPrices = useHasPermission('pricing.prices.manage');
  const canHomes = useHasPermission('inventory.setup.manage');
  const [open, setOpen] = useState<EditAction | StatusAction | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const edits: EditAction[] = [
    ...(canProducts ? (['category'] as const) : []),
    ...(canSuppliers ? (['mainSupplier'] as const) : []),
    ...(canPrices ? (['profile'] as const) : []),
    ...(canHomes ? (['home'] as const) : []),
  ];
  const statuses: StatusAction[] = canProducts ? ['deactivate', 'activate'] : [];
  const close = () => {
    setOpen(null);
    // The menu item is gone by the time a dialog closes: the focus goes back to «Засах».
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  const done = () => {
    setOpen(null);
    props.onDone();
  };
  const { ids } = props;
  const tooMany = ids.length > MAX_BULK_PRODUCTS;
  return (
    <>
      {edits.length > 0 || statuses.length > 0 ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button ref={trigger} variant="outline" size="sm">
              <Pencil />
              {t('catalog.products.bulk.edit')}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {edits.map((action) => (
              <DropdownMenuItem key={action} onSelect={() => setOpen(action)}>
                {t(`catalog.products.bulk.actions.${action}`)}
              </DropdownMenuItem>
            ))}
            {edits.length > 0 && statuses.length > 0 ? <DropdownMenuSeparator /> : null}
            {statuses.map((action) => (
              <DropdownMenuItem key={action} onSelect={() => setOpen(action)}>
                {t(`catalog.products.bulk.actions.${action}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {open !== null && tooMany ? (
        <LimitDialog action={open} count={ids.length} onClose={close} />
      ) : null}
      {open === 'category' && !tooMany ? (
        <CategoryDialog ids={ids} onClose={close} onDone={done} />
      ) : null}
      {open === 'mainSupplier' && !tooMany ? (
        <SupplierDialog ids={ids} onClose={close} onDone={done} />
      ) : null}
      {open === 'profile' && !tooMany ? (
        <ProfileDialog ids={ids} onClose={close} onDone={done} />
      ) : null}
      {open === 'home' && !tooMany ? (
        <HomeDialog ids={ids} rows={props.rows} onClose={close} onDone={done} />
      ) : null}
      {(open === 'activate' || open === 'deactivate') && !tooMany ? (
        <StatusDialog action={open} ids={ids} onClose={close} onDone={done} />
      ) : null}
    </>
  );
}

/** More products are ticked than one change takes (ADR-0052): the dialog only says so. */
function LimitDialog(props: {
  action: EditAction | StatusAction;
  count: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t(`catalog.products.bulk.actions.${props.action}`)}</DialogTitle>
          <DialogDescription>
            {t('catalog.products.bulk.tooMany', {
              total: formatCount(props.count),
              limit: formatCount(MAX_BULK_PRODUCTS),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DialogProps {
  ids: readonly number[];
  onClose: () => void;
  onDone: () => void;
}

/** One bulk change's dialog: the action, the count and its hint, the field, «Болих» and «Хадгалах». */
function BulkDialog(props: {
  action: EditAction;
  count: number;
  pending: boolean;
  disabled: boolean;
  problem: ReturnType<typeof useAction>['problem'];
  submitLabel?: string;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t(`catalog.products.bulk.actions.${props.action}`)}</DialogTitle>
          <DialogDescription>
            <span className="block font-medium text-foreground">
              {t('catalog.products.bulk.count', { count: formatCount(props.count) })}
            </span>
            {t(`catalog.products.bulk.hints.${props.action}`)}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {props.children}
          <ProblemAlert problem={props.problem} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.pending || props.disabled}>
              {props.submitLabel ?? t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ ids, onClose, onDone }: DialogProps) {
  const { t } = useTranslation();
  const edits = useBulkEdits();
  const action = useAction();
  const report = useReport();
  const [key] = useState(randomUuid);
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const submit = async () => {
    if (categoryId === undefined) return;
    let result: { changed: number[]; unchanged: number[] } | undefined;
    if (
      await action.run(async () => {
        result = await edits.category.mutateAsync({ key, productIds: [...ids], categoryId });
      })
    ) {
      if (result) report(result);
      onDone();
    }
  };
  return (
    <BulkDialog
      action="category"
      count={ids.length}
      pending={edits.category.isPending}
      disabled={categoryId === undefined}
      problem={action.problem}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FormField label={t('catalog.products.bulk.category')} htmlFor="bulk-category">
        <NativeSelect
          id="bulk-category"
          value={categoryId === undefined ? '' : String(categoryId)}
          onChange={(event) =>
            setCategoryId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
          }
        >
          <option value="">{t('catalog.products.bulk.chooseCategory')}</option>
          {tree.map((node) => (
            <option key={node.category.id} value={String(node.category.id)}>
              {node.path}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </BulkDialog>
  );
}

function SupplierDialog({ ids, onClose, onDone }: DialogProps) {
  const { t } = useTranslation();
  const edits = useBulkEdits();
  const action = useAction();
  const report = useReport();
  const [key] = useState(randomUuid);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const submit = async () => {
    if (!supplier) return;
    let result: { changed: number[]; unchanged: number[] } | undefined;
    if (
      await action.run(async () => {
        result = await edits.mainSupplier.mutateAsync({
          key,
          productIds: [...ids],
          supplierId: supplier.id,
        });
      })
    ) {
      if (result) report(result);
      onDone();
    }
  };
  return (
    <BulkDialog
      action="mainSupplier"
      count={ids.length}
      pending={edits.mainSupplier.isPending}
      disabled={supplier === null}
      problem={action.problem}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FormField label={t('catalog.products.bulk.supplier')} htmlFor="bulk-supplier">
        <SupplierPicker id="bulk-supplier" value={supplier} onChange={setSupplier} />
      </FormField>
    </BulkDialog>
  );
}

function ProfileDialog({ ids, onClose, onDone }: DialogProps) {
  const { t } = useTranslation();
  const edits = useBulkEdits();
  const action = useAction();
  const report = useReport();
  const [key] = useState(randomUuid);
  const profiles = usePriceProfileChoices();
  const today = businessDate();
  const [profileId, setProfileId] = useState<number | undefined>();
  const [validFrom, setValidFrom] = useState(today);
  const submit = async () => {
    if (profileId === undefined) return;
    let result: { changed: number[]; unchanged: number[]; skipped: unknown[] } | undefined;
    if (
      await action.run(async () => {
        result = await edits.profile.mutateAsync({
          key,
          productIds: [...ids],
          profileId,
          validFrom,
        });
      })
    ) {
      if (result) report(result);
      onDone();
    }
  };
  return (
    <BulkDialog
      action="profile"
      count={ids.length}
      pending={edits.profile.isPending}
      disabled={profileId === undefined || validFrom < today}
      problem={action.problem}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FormField label={t('catalog.products.bulk.profile')} htmlFor="bulk-profile">
        <NativeSelect
          id="bulk-profile"
          value={profileId === undefined ? '' : String(profileId)}
          onChange={(event) =>
            setProfileId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
          }
        >
          <option value="">{t('catalog.products.bulk.chooseProfile')}</option>
          {(profiles.data ?? []).map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={t('catalog.products.bulk.validFrom')} htmlFor="bulk-valid-from">
        <Input
          id="bulk-valid-from"
          type="date"
          min={today}
          className="sm:w-44"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
        />
      </FormField>
    </BulkDialog>
  );
}

/**
 * First a dry run: products holding stock elsewhere are named and confirmed before the move. The
 * names come from the loaded rows, else are read one by one (ticks of other searches, ADR-0052).
 */
function HomeDialog(props: {
  ids: readonly number[];
  rows: readonly ProductListItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const edits = useBulkEdits();
  const action = useAction();
  const report = useReport();
  const [dryKey] = useState(randomUuid);
  const [applyKey] = useState(randomUuid);
  const warehouses = useWarehouses();
  const wholesale = (warehouses.data ?? []).filter((row) => row.kind === 'WHOLESALE');
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [stocked, setStocked] = useState<readonly number[] | null>(null);
  const { ids } = props;
  const loaded = new Map(props.rows.map((row) => [row.id, `${row.sku} ${row.name}`]));
  const shown = (stocked ?? []).slice(0, NAMED);
  const read = useProductNames(shown.filter((id) => !loaded.has(id)));
  const nameOf = (id: number) => loaded.get(id) ?? read.get(id) ?? `#${id}`;

  const apply = async (target: number) => {
    let result: { changed: number[]; unchanged: number[] } | undefined;
    if (
      await action.run(async () => {
        result = await edits.home.mutateAsync({
          key: applyKey,
          productIds: [...ids],
          warehouseId: target,
        });
      })
    ) {
      if (result) report(result);
      props.onDone();
    }
  };
  const submit = async () => {
    if (warehouseId === undefined) return;
    if (stocked) {
      await apply(warehouseId);
      return;
    }
    let dry: { changed: number[]; unchanged: number[]; withStock: { productId: number }[] } = {
      changed: [],
      unchanged: [],
      withStock: [],
    };
    const checked = await action.run(async () => {
      dry = await edits.home.mutateAsync({
        key: dryKey,
        productIds: [...ids],
        warehouseId,
        dryRun: true,
      });
    });
    if (!checked) return;
    const found = [...new Set(dry.withStock.map((row) => row.productId))];
    if (dry.changed.length === 0) {
      // Every product already lives there: nothing to write.
      report(dry);
      props.onDone();
    } else if (found.length === 0) {
      // Nothing holds stock elsewhere: no question to ask.
      await apply(warehouseId);
    } else {
      setStocked(found);
    }
  };
  return (
    <BulkDialog
      action="home"
      count={ids.length}
      pending={edits.home.isPending}
      disabled={warehouseId === undefined}
      problem={action.problem}
      {...(stocked ? { submitLabel: t('catalog.products.bulk.move') } : {})}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      <FormField label={t('catalog.products.bulk.warehouse')} htmlFor="bulk-warehouse">
        <NativeSelect
          id="bulk-warehouse"
          disabled={stocked !== null}
          value={warehouseId === undefined ? '' : String(warehouseId)}
          onChange={(event) =>
            setWarehouseId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
          }
        >
          <option value="">{t('catalog.products.bulk.chooseWarehouse')}</option>
          {wholesale.map((row) => (
            <option key={row.id} value={String(row.id)}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {stocked ? (
        <div role="alert" className="flex flex-col gap-1.5 rounded-lg bg-warning-soft p-3 text-sm">
          <p>{t('catalog.products.bulk.withStock', { count: formatCount(stocked.length) })}</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {shown.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
            {stocked.length > NAMED ? (
              <li>
                {t('catalog.products.bulk.more', { count: formatCount(stocked.length - NAMED) })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </BulkDialog>
  );
}

function StatusDialog(props: {
  action: StatusAction;
  ids: readonly number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const edits = useBulkEdits();
  const action = useAction();
  const report = useReport();
  const [key] = useState(randomUuid);
  const confirm = async () => {
    let result: { changed: number[]; unchanged: number[] } | undefined;
    if (
      await action.run(async () => {
        result = await edits.status.mutateAsync({
          key,
          productIds: [...props.ids],
          status: props.action === 'activate' ? 'ACTIVE' : 'INACTIVE',
        });
      })
    ) {
      if (result) report(result);
      props.onDone();
    }
  };
  return (
    <ConfirmDialog
      open
      title={t(`catalog.products.bulk.${props.action}Title`, {
        count: formatCount(props.ids.length),
      })}
      description={t('catalog.products.bulk.statusHint')}
      confirmLabel={t(`catalog.products.bulk.actions.${props.action}`)}
      variant={props.action === 'deactivate' ? 'destructive' : 'default'}
      pending={edits.status.isPending}
      problem={action.problem}
      onConfirm={() => void confirm()}
      onClose={props.onClose}
    />
  );
}
