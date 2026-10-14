import {
  MAX_GROUP_CONDITIONS,
  MAX_SEGMENT_GROUPS,
  operatorSlots,
  SEGMENT_FIELDS,
  type SegmentCondition,
  type SegmentDefinition,
  type SegmentEntity,
  type SegmentGroup,
  type SegmentMatch,
  type SegmentOperator,
} from '@tugeel/shared/segments';
import type { TFunction } from 'i18next';
import { Plus, X } from 'lucide-react';
import { Fragment, useDeferredValue, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxGroup } from '@/components/checkbox-group';
import { SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCategories } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { useWarehouses } from '@/features/identity/api';
import { useSuppliers, useSuppliersByIds } from '@/features/partners/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { formatMnt } from '@/lib/money';
import { fieldLabel, NO_IDS, SELLING_KINDS, useIdNames, valueLabel } from './condition-labels';
import { newCondition, withOperator } from './segment-definition';

/** One condition in words: «Ангилал аль нэг нь: Ундаа», «Үлдэгдэл: дууссан · Бөөний агуулах». */
export function ConditionText(props: { entity: SegmentEntity; condition: SegmentCondition }) {
  const { t } = useTranslation();
  const { entity, condition } = props;
  const spec = SEGMENT_FIELDS[entity][condition.field];
  const names = useIdNames(
    condition.field,
    condition.field === 'stock' && condition.warehouseId
      ? [condition.warehouseId]
      : (condition.ids ?? NO_IDS),
  );
  const field = fieldLabel(t, entity, condition.field);
  const op = t(`segments.operators.${condition.op}`);
  const pending = t('common.loading');
  switch (spec?.input) {
    case 'ids':
      return condition.ids
        ? t('segments.format.withOp', { field, op, value: names?.join(', ') ?? pending })
        : t('segments.format.plain', { field, value: op });
    case 'values': {
      const value = (condition.values ?? []).map((item) => valueLabel(t, condition.field, item));
      return condition.op === 'IS'
        ? t('segments.format.plain', { field, value: value.join(', ') })
        : t('segments.format.withOp', { field, op, value: value.join(', ') });
    }
    case 'dates':
      return t('segments.format.plain', { field, value: datesText(t, condition) });
    case 'money':
      return t('segments.format.plain', { field, value: moneyText(t, condition) });
    case 'text':
      return t('segments.format.plain', {
        field,
        value: t('segments.format.quoted', { text: condition.text ?? '' }),
      });
    case 'stock':
      return t('segments.format.plain', {
        field,
        value: condition.warehouseId ? `${op} · ${names?.[0] ?? pending}` : op,
      });
    default:
      return t('segments.format.plain', { field, value: op });
  }
}

function datesText(t: TFunction, condition: SegmentCondition): string {
  if (condition.op === 'LAST_DAYS') {
    return condition.days === 1
      ? t('catalog.products.filters.today')
      : t('catalog.products.filters.lastDays', { count: condition.days ?? 0 });
  }
  return rangeText(t, condition.from, condition.to);
}

function moneyText(t: TFunction, condition: SegmentCondition): string {
  const money = (value: string | undefined) =>
    value ? t('pricing.money', { amount: formatMnt(value) }) : undefined;
  return rangeText(t, money(condition.min), money(condition.max));
}

function rangeText(t: TFunction, from: string | undefined, to: string | undefined): string {
  if (from && to) return t('catalog.products.filters.between', { from, to });
  if (from) return t('catalog.products.filters.atLeast', { value: from });
  return t('catalog.products.filters.atMost', { value: to ?? '' });
}

/** A definition in words, group by group, for a segment's page. */
export function DefinitionText(props: { entity: SegmentEntity; definition: SegmentDefinition }) {
  const { t } = useTranslation();
  const { entity, definition } = props;
  return (
    <div className="flex flex-col gap-2">
      {definition.groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t(`segments.join.${definition.match}`)}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5 rounded-lg border border-border/80 p-3">
            {definition.groups.length > 1 ? (
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t('segments.group', { n: index + 1 })}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1 text-sm">
              {group.conditions.map((condition, at) => (
                <li key={at}>
                  {at > 0 ? (
                    <span className="mr-1.5 text-muted-foreground">
                      {t(`segments.join.${group.match}`)}
                    </span>
                  ) : null}
                  <ConditionText entity={entity} condition={condition} />
                </li>
              ))}
            </ul>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The editor

/** The definition editor (ADR-0049): groups of conditions, each «Бүгд биелэх» or «Аль нэг нь». */
export function DefinitionEditor(props: {
  entity: SegmentEntity;
  value: SegmentDefinition;
  onChange: (next: SegmentDefinition) => void;
}) {
  const { t } = useTranslation();
  const { entity, value, onChange } = props;
  const setGroup = (index: number, group: SegmentGroup) =>
    onChange({ ...value, groups: value.groups.map((item, at) => (at === index ? group : item)) });
  return (
    <div className="flex flex-col gap-3">
      {value.groups.length > 1 ? (
        <MatchSelect
          label={t('segments.groupsMatch')}
          value={value.match}
          onChange={(match) => onChange({ ...value, match })}
        />
      ) : null}
      {value.groups.map((group, index) => (
        <GroupEditor
          // Groups only change by the editor's own buttons; a removed group takes its rows along.
          key={index}
          entity={entity}
          index={index}
          group={group}
          onChange={(next) => setGroup(index, next)}
          {...(value.groups.length > 1
            ? {
                onRemove: () =>
                  onChange({ ...value, groups: value.groups.filter((_, at) => at !== index) }),
              }
            : {})}
        />
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.groups.length >= MAX_SEGMENT_GROUPS}
          onClick={() =>
            onChange({
              ...value,
              groups: [...value.groups, { match: 'ALL', conditions: [newCondition(entity)] }],
            })
          }
        >
          <Plus />
          {t('segments.addGroup')}
        </Button>
      </div>
    </div>
  );
}

function MatchSelect(props: {
  label: string;
  value: SegmentMatch;
  onChange: (match: SegmentMatch) => void;
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      aria-label={props.label}
      className="sm:w-56"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value === 'ANY' ? 'ANY' : 'ALL')}
    >
      <option value="ALL">{t('segments.matches.ALL')}</option>
      <option value="ANY">{t('segments.matches.ANY')}</option>
    </NativeSelect>
  );
}

function GroupEditor(props: {
  entity: SegmentEntity;
  index: number;
  group: SegmentGroup;
  onChange: (next: SegmentGroup) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const { entity, index, group, onChange } = props;
  const title = t('segments.group', { n: index + 1 });
  const setCondition = (at: number, condition: SegmentCondition) =>
    onChange({
      ...group,
      conditions: group.conditions.map((item, place) => (place === at ? condition : item)),
    });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-xl border border-border/90 bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {group.conditions.length > 1 ? (
          <MatchSelect
            label={t('segments.conditionsMatch', { n: index + 1 })}
            value={group.match}
            onChange={(match) => onChange({ ...group, match })}
          />
        ) : null}
        {props.onRemove ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="ml-auto text-muted-foreground hover:bg-danger-soft hover:text-destructive"
            aria-label={`${t('segments.removeGroup')}: ${title}`}
            title={t('segments.removeGroup')}
            onClick={props.onRemove}
          >
            <X />
          </Button>
        ) : null}
      </div>
      {group.conditions.map((condition, at) => (
        <ConditionEditor
          key={at}
          entity={entity}
          label={`${title}, ${at + 1}`}
          condition={condition}
          onChange={(next) => setCondition(at, next)}
          {...(group.conditions.length > 1
            ? {
                onRemove: () =>
                  onChange({
                    ...group,
                    conditions: group.conditions.filter((_, place) => place !== at),
                  }),
              }
            : {})}
        />
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-link"
          disabled={group.conditions.length >= MAX_GROUP_CONDITIONS}
          onClick={() =>
            onChange({ ...group, conditions: [...group.conditions, newCondition(entity)] })
          }
        >
          <Plus />
          {t('segments.addCondition')}
        </Button>
      </div>
    </section>
  );
}

/** One condition: the field, its operator, the value the operator takes. */
function ConditionEditor(props: {
  entity: SegmentEntity;
  /** «Бүлэг 1, 2»: names the row's controls for screen readers and tests. */
  label: string;
  condition: SegmentCondition;
  onChange: (next: SegmentCondition) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const { entity, condition, onChange, label } = props;
  const fields = Object.keys(SEGMENT_FIELDS[entity]);
  const spec = SEGMENT_FIELDS[entity][condition.field];
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2 sm:flex-row sm:flex-wrap sm:items-start">
      <NativeSelect
        aria-label={`${t('segments.field')}: ${label}`}
        className="sm:w-48"
        value={condition.field}
        onChange={(event) => onChange(newCondition(entity, event.target.value))}
      >
        {fields.map((field) => (
          <option key={field} value={field}>
            {fieldLabel(t, entity, field)}
          </option>
        ))}
      </NativeSelect>
      {spec && spec.ops.length > 1 ? (
        <NativeSelect
          aria-label={`${t('segments.operator')}: ${label}`}
          className="sm:w-48"
          value={condition.op}
          onChange={(event) =>
            onChange(withOperator(entity, condition, event.target.value as SegmentOperator))
          }
        >
          {spec.ops.map((op) => (
            <option key={op} value={op}>
              {t(`segments.operators.${op}`)}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      <div className="min-w-0 flex-1">
        <ValueEditor entity={entity} label={label} condition={condition} onChange={onChange} />
      </div>
      {props.onRemove ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="self-end text-muted-foreground hover:bg-danger-soft hover:text-destructive sm:self-start"
          aria-label={`${t('segments.removeCondition')}: ${label}`}
          title={t('segments.removeCondition')}
          onClick={props.onRemove}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}

function ValueEditor(props: {
  entity: SegmentEntity;
  label: string;
  condition: SegmentCondition;
  onChange: (next: SegmentCondition) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { entity, condition, onChange, label } = props;
  const spec = SEGMENT_FIELDS[entity][condition.field];
  if (!spec) return null;
  const { required, optional } = operatorSlots(spec.input, condition.op);
  const slots = [...required, ...optional];
  if (slots.includes('ids')) {
    return (
      <IdsPicker
        field={condition.field}
        title={fieldLabel(t, entity, condition.field)}
        label={label}
        ids={condition.ids ?? []}
        onChange={(ids) => onChange({ ...condition, ids })}
      />
    );
  }
  if (slots.includes('values')) {
    const values = spec.values ?? [];
    if (spec.single) {
      return (
        <NativeSelect
          aria-label={`${t('segments.choose')}: ${label}`}
          value={condition.values?.[0] ?? ''}
          onChange={(event) =>
            onChange({ ...condition, values: event.target.value ? [event.target.value] : [] })
          }
        >
          <option value="">{t('segments.choose')}</option>
          {values.map((value) => (
            <option key={value} value={value}>
              {valueLabel(t, condition.field, value)}
            </option>
          ))}
        </NativeSelect>
      );
    }
    return (
      <CheckboxGroup
        name={`${id}-values`}
        options={values.map((value) => ({ value, label: valueLabel(t, condition.field, value) }))}
        value={condition.values ?? []}
        onChange={(chosen) => onChange({ ...condition, values: chosen })}
      />
    );
  }
  if (slots.includes('days')) {
    return (
      <Input
        aria-label={`${t('segments.days')}: ${label}`}
        inputMode="numeric"
        className="font-mono sm:w-28"
        value={condition.days === undefined ? '' : String(condition.days)}
        onChange={(event) => {
          const days = Number.parseInt(event.target.value, 10);
          const { days: _old, ...rest } = condition;
          onChange(Number.isSafeInteger(days) ? { ...rest, days } : rest);
        }}
      />
    );
  }
  if (slots.includes('from')) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {(['from', 'to'] as const).map((slot) => (
          <Input
            key={slot}
            type="date"
            aria-label={`${t(`catalog.products.filters.${slot}`)}: ${label}`}
            value={condition[slot] ?? ''}
            onChange={(event) => {
              const { [slot]: _old, ...rest } = condition;
              onChange(event.target.value ? { ...rest, [slot]: event.target.value } : rest);
            }}
          />
        ))}
      </div>
    );
  }
  if (slots.includes('min')) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {(['min', 'max'] as const).map((slot) => (
          <Input
            key={slot}
            inputMode="numeric"
            className="font-mono"
            aria-label={`${t(slot === 'min' ? 'catalog.products.filters.minPrice' : 'catalog.products.filters.maxPrice')}: ${label}`}
            value={condition[slot] ?? ''}
            onChange={(event) => {
              const typed = event.target.value.replace(/[\s,]/g, '');
              const { [slot]: _old, ...rest } = condition;
              onChange(typed ? { ...rest, [slot]: typed } : rest);
            }}
          />
        ))}
      </div>
    );
  }
  if (slots.includes('text')) {
    return (
      <Input
        aria-label={`${t('segments.text')}: ${label}`}
        value={condition.text ?? ''}
        onChange={(event) => onChange({ ...condition, text: event.target.value })}
      />
    );
  }
  if (slots.includes('warehouseId')) {
    return <WarehouseSelect label={label} condition={condition} onChange={onChange} />;
  }
  return null;
}

function WarehouseSelect(props: {
  label: string;
  condition: SegmentCondition;
  onChange: (next: SegmentCondition) => void;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const rows = (warehouses.data ?? []).filter((row) => SELLING_KINDS.includes(row.kind));
  const { condition, onChange } = props;
  return (
    <NativeSelect
      aria-label={`${t('catalog.products.filters.warehouse')}: ${props.label}`}
      value={condition.warehouseId === undefined ? '' : String(condition.warehouseId)}
      onChange={(event) => {
        const { warehouseId: _old, ...rest } = condition;
        onChange(
          event.target.value
            ? { ...rest, warehouseId: Number.parseInt(event.target.value, 10) }
            : rest,
        );
      }}
    >
      <option value="">{t('catalog.products.filters.allSellingWarehouses')}</option>
      {rows.map((row) => (
        <option key={row.id} value={String(row.id)}>
          {row.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The chosen records of an `ids` condition: their names on a button that opens the choices. */
function IdsPicker(props: {
  field: string;
  title: string;
  label: string;
  ids: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const names = useIdNames(props.field, props.ids);
  const text =
    props.ids.length === 0
      ? t('segments.choose')
      : (names?.join(', ') ?? t('segments.chosen', { count: props.ids.length }));
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-8 w-full justify-start py-1.5 text-left font-normal whitespace-normal"
        // The visible names end the accessible name (WCAG 2.5.3).
        aria-label={`${props.title} (${props.label}): ${text}`}
        onClick={() => setOpen(true)}
      >
        {text}
      </Button>
      {open ? (
        <IdsDialog
          field={props.field}
          title={props.title}
          ids={props.ids}
          onApply={(ids) => {
            props.onChange(ids);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function IdsDialog(props: {
  field: string;
  title: string;
  ids: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [ids, setIds] = useState(props.ids);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            props.onApply(ids);
          }}
        >
          <Choices field={props.field} initial={props.ids} ids={ids} onChange={setIds} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('segments.choose')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The records an `ids` field offers; suppliers by search, the chosen ones kept in the list. */
function Choices(props: {
  field: string;
  initial: readonly number[];
  ids: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const categories = useCategories();
  const warehouses = useWarehouses();
  const profiles = usePriceProfileChoices();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const supplierField = props.field === 'supplier';
  const found = useSuppliers({ q }, { limit: 20, enabled: supplierField });
  const chosen = useSuppliersByIds(supplierField ? props.initial : NO_IDS);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  let options: { value: number; label: string }[] | undefined;
  switch (props.field) {
    case 'category':
      options = categories.data
        ?.map((row) => ({ value: row.id, label: paths.get(row.id) ?? row.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'mn'));
      break;
    case 'homeWarehouse':
      options = warehouses.data
        ?.filter((row) => SELLING_KINDS.includes(row.kind))
        .map((row) => ({ value: row.id, label: row.name }));
      break;
    case 'priceProfile':
      options = profiles.data?.map((row) => ({ value: row.id, label: row.name }));
      break;
    case 'supplier': {
      const rows = new Map<number, string>();
      for (const row of [...(chosen.data ?? []), ...(found.data?.pages[0]?.data ?? [])]) {
        rows.set(row.id, row.name);
      }
      options = found.data ? [...rows].map(([value, label]) => ({ value, label })) : undefined;
      break;
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {supplierField ? (
        <SearchField
          className="sm:w-full"
          aria-label={t('catalog.products.filters.searchSupplier')}
          placeholder={t('catalog.products.filters.searchSupplier')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      <div className="max-h-72 overflow-y-auto rounded-lg border p-3">
        {!options ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('catalog.products.filters.noMatches')}</p>
        ) : (
          <CheckboxGroup
            name={`choices-${props.field}`}
            options={options}
            value={props.ids}
            onChange={props.onChange}
          />
        )}
      </div>
    </div>
  );
}
