import { ArrowDown, ArrowUp, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { FieldError } from '@/components/field-error';
import { LeaveGuard } from '@/components/leave-guard';
import { EmptyState, ListCard, RowAction, RowActions } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type ProductSummary, type ProductUnit, useProduct } from '@/features/catalog/api';
import { ProductSearch } from '@/features/inventory/shared';
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type QuickButton, type QuickGroup, useQuickButtons, usePosMutations } from './api';

/** The server's limits on the set (ADR-0104). */
const MAX_GROUPS = 12;
const MAX_BUTTONS = 60;
const MAX_TEXT = 40;

interface DraftGroup {
  /** The saved group's id, or a new one's local key: React's key only, never sent. */
  key: string;
  name: string;
  buttons: QuickButton[];
}

const draftOf = (groups: readonly QuickGroup[]): DraftGroup[] =>
  groups.map((group) => ({ key: `g${group.id}`, name: group.name, buttons: group.buttons }));

let newGroups = 0;

/** The list with the entry at `index` moved one place by `delta` (−1 up, +1 down). */
function moved<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/**
 * «Товчнууд» (ADR-0104): the till's F7 panel of quick buttons, groups and their products in order.
 * A `pos.manage` holder edits the whole set here and one «Хадгалах» replaces it; others read it.
 */
export function PosQuickButtonsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const saved = useQuickButtons();
  const mutations = usePosMutations();
  const action = useAction();
  // Null until the first change: the page shows the saved set.
  const [draft, setDraft] = useState<DraftGroup[] | null>(null);
  const [checked, setChecked] = useState(false);
  const groups = draft ?? draftOf(saved.data ?? []);
  const dirty = draft !== null;
  const buttonCount = groups.reduce((sum, group) => sum + group.buttons.length, 0);

  const updateGroup = (index: number, patch: Partial<DraftGroup>) =>
    setDraft(groups.map((group, at) => (at === index ? { ...group, ...patch } : group)));
  const addGroup = () => {
    newGroups += 1;
    setDraft([
      ...groups,
      {
        key: `new${newGroups}`,
        name: t('pos.quickButtons.newGroupName', { number: groups.length + 1 }),
        buttons: [],
      },
    ]);
  };

  const save = () => {
    setChecked(true);
    if (groups.some((group) => group.name.trim() === '')) return;
    void action
      .run(async () => {
        await mutations.saveQuickButtons.mutateAsync({
          groups: groups.map((group) => ({
            name: group.name.trim(),
            buttons: group.buttons.map((button) => ({
              productUnitId: button.productUnitId,
              label: button.label?.trim() ? button.label.trim() : null,
            })),
          })),
        });
        toast.success(t('pos.quickButtons.saved'));
      })
      .then((ok) => {
        if (ok) {
          setDraft(null);
          setChecked(false);
        }
      });
  };

  return (
    <div>
      <PageHeader
        title={t('pos.quickButtons.title')}
        description={t('pos.quickButtons.description')}
        meta={
          saved.data ? (
            <span className="tabular-nums">
              {t('pos.quickButtons.count', { groups: groups.length, buttons: buttonCount })}
            </span>
          ) : undefined
        }
        actions={
          canManage ? (
            <Button
              variant="outline"
              disabled={!saved.data || groups.length >= MAX_GROUPS}
              onClick={addGroup}
            >
              <Plus />
              {t('pos.quickButtons.addGroup')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(saved.error) ?? action.problem} />
      {!saved.isPending && groups.length === 0 ? (
        <ListCard>
          <EmptyState icon={LayoutGrid} title={t('pos.quickButtons.empty')} />
        </ListCard>
      ) : null}
      <div className="flex flex-col gap-4">
        {groups.map((group, index) => (
          <GroupCard
            key={group.key}
            group={group}
            index={index}
            last={index === groups.length - 1}
            canManage={canManage}
            nameError={checked && group.name.trim() === '' ? 'validation.required' : undefined}
            onChange={(patch) => updateGroup(index, patch)}
            onMove={(delta) => setDraft(moved(groups, index, delta))}
            onRemove={() => setDraft(groups.filter((_, at) => at !== index))}
          />
        ))}
      </div>
      {canManage ? (
        <div className="mt-4">
          <StickyActions
            summary={dirty ? t('pos.quickButtons.unsaved') : t('pos.quickButtons.limits')}
          >
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty}
              onClick={() => {
                setDraft(null);
                setChecked(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!dirty || mutations.saveQuickButtons.isPending}
              onClick={save}
            >
              {t('common.save')}
            </Button>
          </StickyActions>
        </div>
      ) : null}
      <LeaveGuard
        when={dirty}
        title={t('pos.quickButtons.leaveTitle')}
        description={t('pos.quickButtons.leaveDescription')}
        leaveLabel={t('pos.quickButtons.leave')}
      />
    </div>
  );
}

/** One group: its name, its buttons in order and, for a manager, the product search that adds one. */
function GroupCard(props: {
  group: DraftGroup;
  index: number;
  last: boolean;
  canManage: boolean;
  nameError: string | undefined;
  onChange: (patch: Partial<DraftGroup>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { group, canManage } = props;
  const [picked, setPicked] = useState<ProductSummary | null>(null);
  const id = useId();
  const title =
    group.name.trim() || t('pos.quickButtons.newGroupName', { number: props.index + 1 });
  const buttons = group.buttons;
  const setButtons = (next: QuickButton[]) => props.onChange({ buttons: next });
  const named = (button: QuickButton) =>
    t('inventory.productUnit', { product: button.productName, unit: button.uomName });

  const add = (button: QuickButton) => {
    setPicked(null);
    if (buttons.some((entry) => entry.productUnitId === button.productUnitId)) {
      toast.info(
        t('pos.quickButtons.duplicate', { name: button.productName, unit: button.uomName }),
      );
      return;
    }
    setButtons([...buttons, button]);
  };

  return (
    <section aria-label={title}>
      <ListCard>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          {canManage ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Input
                aria-label={`${t('pos.fields.groupName')}: ${props.index + 1}`}
                aria-invalid={props.nameError ? true : undefined}
                className="sm:w-72"
                value={group.name}
                maxLength={MAX_TEXT}
                onChange={(event) => props.onChange({ name: event.target.value })}
              />
              <FieldError message={props.nameError} />
            </div>
          ) : (
            <h2 className="min-w-0 flex-1 text-base font-semibold">{group.name}</h2>
          )}
          <span className="text-sm text-muted-foreground tabular-nums">
            {buttons.length} / {MAX_BUTTONS}
          </span>
          {canManage ? (
            <RowActions>
              <RowAction
                label={`${t('pos.quickButtons.moveUp')}: ${title}`}
                icon={ArrowUp}
                disabled={props.index === 0}
                onClick={() => props.onMove(-1)}
              />
              <RowAction
                label={`${t('pos.quickButtons.moveDown')}: ${title}`}
                icon={ArrowDown}
                disabled={props.last}
                onClick={() => props.onMove(1)}
              />
              <RowAction
                label={`${t('pos.quickButtons.removeGroup')}: ${title}`}
                icon={Trash2}
                destructive
                onClick={props.onRemove}
              />
            </RowActions>
          ) : null}
        </div>
        {buttons.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">{t('pos.fields.number')}</TableHead>
                <TableHead>{t('pos.fields.product')}</TableHead>
                <TableHead>{t('pos.fields.unit')}</TableHead>
                <TableHead>{t('pos.fields.buttonLabel')}</TableHead>
                {canManage ? <TableHead className="w-px" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {buttons.map((button, at) => (
                <TableRow key={button.productUnitId}>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {at + 1}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="font-mono text-muted-foreground">{button.productSku}</span>{' '}
                    {button.productName}
                    {button.sellable ? null : (
                      <Badge
                        variant="warning"
                        className="ml-2"
                        title={t('pos.quickButtons.notSellableHint')}
                      >
                        {t('pos.quickButtons.notSellable')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{button.uomName}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Input
                        aria-label={`${t('pos.fields.buttonLabel')}: ${named(button)}`}
                        className="h-8 sm:w-56"
                        placeholder={button.productName}
                        value={button.label ?? ''}
                        maxLength={MAX_TEXT}
                        onChange={(event) =>
                          setButtons(
                            buttons.map((entry, row) =>
                              row === at ? { ...entry, label: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    ) : (
                      (button.label ?? (
                        <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                      ))
                    )}
                  </TableCell>
                  {canManage ? (
                    <RowActions>
                      <RowAction
                        label={`${t('pos.quickButtons.moveUp')}: ${named(button)}`}
                        icon={ArrowUp}
                        disabled={at === 0}
                        onClick={() => setButtons(moved(buttons, at, -1))}
                      />
                      <RowAction
                        label={`${t('pos.quickButtons.moveDown')}: ${named(button)}`}
                        icon={ArrowDown}
                        disabled={at === buttons.length - 1}
                        onClick={() => setButtons(moved(buttons, at, 1))}
                      />
                      <RowAction
                        label={`${t('pos.quickButtons.removeButton')}: ${named(button)}`}
                        icon={Trash2}
                        destructive
                        onClick={() => setButtons(buttons.filter((_, row) => row !== at))}
                      />
                    </RowActions>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t('pos.quickButtons.groupEmpty')}
          </p>
        )}
        {canManage ? (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            {buttons.length >= MAX_BUTTONS ? (
              <p className="text-sm text-muted-foreground">{t('pos.quickButtons.groupFull')}</p>
            ) : (
              <>
                <label htmlFor={id} className="sr-only">
                  {`${t('pos.quickButtons.addProduct')}: ${title}`}
                </label>
                <ProductSearch
                  id={id}
                  saleReady
                  pickLabel={t('pos.quickButtons.addProduct')}
                  onPick={setPicked}
                />
              </>
            )}
            {picked ? (
              <UnitChoice product={picked} onChoose={add} onCancel={() => setPicked(null)} />
            ) : null}
          </div>
        ) : null}
      </ListCard>
    </section>
  );
}

/** A new button for the picked product's unit; the server says on save whether the till sells it. */
function buttonOf(product: ProductSummary, unit: ProductUnit): QuickButton {
  return {
    productUnitId: unit.id,
    productId: product.id,
    productSku: product.sku,
    productName: product.name,
    uomName: unit.uomName,
    label: null,
    sellable: true,
  };
}

/**
 * The unit a picked product's button sells: one current unit is taken at once, several are offered
 * as buttons («1 хайрцаг = 24 ш»).
 */
function UnitChoice(props: {
  product: ProductSummary;
  onChoose: (button: QuickButton) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { product, onChoose } = props;
  const detail = useProduct(product.id);
  const units = (detail.data?.units ?? []).filter((unit) => unit.supersededAt === null);
  const base = units.find((unit) => unit.isBase);
  const only = units.length === 1 ? units[0] : undefined;

  // The parent clears the choice as it takes the button, so this runs once per picked product.
  useEffect(() => {
    if (only) onChoose(buttonOf(product, only));
  }, [only, onChoose, product]);

  if (detail.error) return <ProblemAlert problem={problemFromError(detail.error)} />;
  if (units.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{t('pos.quickButtons.chooseUnit', { name: product.name })}</span>
      {units.map((unit) => (
        <Button
          key={unit.id}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChoose(buttonOf(product, unit))}
        >
          {unit.isBase || !base
            ? unit.uomName
            : t('catalog.units.factorOf', {
                unit: unit.uomName,
                factor: plainDecimal(unit.factorToBase),
                base: base.uomName,
              })}
        </Button>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
