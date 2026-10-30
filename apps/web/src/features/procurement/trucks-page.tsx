import { Pencil, Plus, Power, Truck as TruckIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { type Truck, useCreateTruck, useTrucks, useUpdateTruck } from './api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'plate', kind: 'code' },
  { key: 'capacity', kind: 'qty' },
  { key: 'status', kind: 'status' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

/**
 * «Машинууд» (ADR-0122): the company's trucks named on purchase orders — a list with the inactive
 * ones on request, a dialog to register or change one, deactivation (a deactivated truck keeps its
 * name on every order it was loaded on). Managers change, order readers look.
 */
export function TrucksPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const [params, setParams] = useSearchParams();
  const [inactive, setInactive] = useState(false);
  const trucks = useTrucks(true, true);
  const update = useUpdateTruck();
  const action = useAction();
  const [editing, setEditing] = useState<Truck | null>(null);
  const creating = params.get('new') === '1';
  const rows = (trucks.data ?? []).filter((truck) => inactive || truck.isActive);

  const openNew = () => {
    const next = new URLSearchParams(params);
    next.set('new', '1');
    setParams(next);
  };
  const closeNew = () => {
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next);
  };
  const toggle = (truck: Truck) =>
    void action.run(async () => {
      await update.mutateAsync({ id: truck.id, isActive: !truck.isActive });
      toast.success(
        t(truck.isActive ? 'procurement.trucks.deactivated' : 'procurement.trucks.activated', {
          name: truck.name,
        }),
      );
    });

  return (
    <div>
      <PageHeader
        title={t('procurement.trucks.title')}
        description={t('procurement.trucks.description')}
        crumbs={[{ label: t('procurement.orders.title'), to: '/procurement/orders' }]}
        actions={
          canManage ? (
            <Button onClick={openNew}>
              <Plus aria-hidden />
              {t('procurement.trucks.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <FilterToggle
          label={t('procurement.trucks.showInactive')}
          checked={inactive}
          onCheckedChange={setInactive}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(trucks.error) ?? action.problem} />
      <ListCard scroll>
        {rows.length === 0 && !trucks.isPending ? (
          <EmptyState
            icon={TruckIcon}
            title={t('procurement.trucks.empty')}
            action={
              canManage ? (
                <Button onClick={openNew}>
                  <Plus aria-hidden />
                  {t('procurement.trucks.create')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('procurement.trucks.columns.name')}</TableHead>
                <TableHead>{t('procurement.trucks.columns.plate')}</TableHead>
                <TableHead className="text-right">
                  {t('procurement.trucks.columns.capacity')}
                </TableHead>
                <TableHead>{t('procurement.trucks.columns.status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((truck) => (
                <TableRow key={truck.id} className={cn(!truck.isActive && 'text-muted-foreground')}>
                  <TableCell className="font-medium">{truck.name}</TableCell>
                  <TableCell className="font-mono">{truck.plate ?? ''}</TableCell>
                  <TableCell className="text-right font-mono">
                    {truck.capacityKg
                      ? t('procurement.supplier.kg', { kg: formatQty(truck.capacityKg) })
                      : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={truck.isActive ? 'success' : 'secondary'}>
                      {t(
                        truck.isActive
                          ? 'procurement.trucks.active'
                          : 'procurement.trucks.inactive',
                      )}
                    </Badge>
                  </TableCell>
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={t('procurement.trucks.editNamed', { name: truck.name })}
                          icon={Pencil}
                          onClick={() => setEditing(truck)}
                        />
                        <RowAction
                          label={t(
                            truck.isActive
                              ? 'procurement.trucks.deactivateNamed'
                              : 'procurement.trucks.activateNamed',
                            { name: truck.name },
                          )}
                          icon={Power}
                          destructive={truck.isActive}
                          disabled={update.isPending}
                          onClick={() => toggle(truck)}
                        />
                      </>
                    ) : null}
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      <Dialog open={creating} onOpenChange={(open) => (open ? openNew() : closeNew())}>
        {creating ? <TruckDialog truck={null} onClose={closeNew} /> : null}
      </Dialog>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? <TruckDialog truck={editing} onClose={() => setEditing(null)} /> : null}
      </Dialog>
    </div>
  );
}

/** A truck registered or changed: name, plate and what it carries, in kg. */
export function TruckDialog(props: {
  truck: Truck | null;
  onClose: () => void;
  onCreated?: (truck: Truck) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateTruck();
  const update = useUpdateTruck();
  const action = useAction();
  const [name, setName] = useState(props.truck?.name ?? '');
  const [plate, setPlate] = useState(props.truck?.plate ?? '');
  const [capacity, setCapacity] = useState(props.truck?.capacityKg ?? '');
  const pending = create.isPending || update.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = {
      name: name.trim(),
      plate: plate.trim() === '' ? null : plate.trim(),
      capacityKg: capacity.trim() === '' ? null : capacity.trim().replace(',', '.'),
    };
    void action.run(async () => {
      if (props.truck) {
        const saved = await update.mutateAsync({ id: props.truck.id, ...body });
        toast.success(t('procurement.trucks.saved', { name: saved.name }));
        props.onClose();
        return;
      }
      const truck = await create.mutateAsync(body);
      toast.success(t('procurement.overview.truckCreated', { name: truck.name }));
      if (props.onCreated) props.onCreated(truck);
      else props.onClose();
    });
  };
  return (
    <DialogContent size="sm" closeLabel={t('common.close')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>
            {t(props.truck ? 'procurement.trucks.editTitle' : 'procurement.overview.newTruckTitle')}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.overview.truckName')} htmlFor="truck-name">
          <Input
            id="truck-name"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('procurement.overview.truckPlate')} htmlFor="truck-plate">
          <Input
            id="truck-plate"
            value={plate}
            maxLength={20}
            onChange={(event) => setPlate(event.target.value)}
          />
        </FormField>
        <FormField label={t('procurement.overview.truckCapacity')} htmlFor="truck-capacity">
          <Input
            id="truck-capacity"
            inputMode="decimal"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </FormField>
        <DialogFormFooter
          pending={pending}
          disabled={name.trim() === ''}
          submitLabel={t(props.truck ? 'common.save' : 'procurement.overview.truckCreate')}
          onCancel={props.onClose}
        />
      </form>
    </DialogContent>
  );
}
