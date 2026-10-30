import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type Category, useCategories } from '@/features/catalog/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { type Till, useCashiers, usePosMutations } from './api';

/**
 * «Эрх ба бараа» of a till (ADR-0124): the cashiers who may sign in at it, the supervisors who may
 * approve at it, and the categories it sells (everything under a ticked category). An empty list
 * means no restriction: every cashier, every supervisor, every product.
 */
export function TillAccessDialog({ till, onClose }: { till: Till; onClose: () => void }) {
  const { t } = useTranslation();
  const cashiers = useCashiers();
  const categories = useCategories();
  const mutations = usePosMutations();
  const action = useAction();
  const [cashierIds, setCashierIds] = useState<ReadonlySet<number>>(
    () => new Set(till.cashierUserIds),
  );
  const [supervisorIds, setSupervisorIds] = useState<ReadonlySet<number>>(
    () => new Set(till.supervisorUserIds),
  );
  const [categoryIds, setCategoryIds] = useState<ReadonlySet<number>>(
    () => new Set(till.categoryIds),
  );
  const active = (cashiers.data ?? []).filter(
    (cashier) => cashier.status === 'ACTIVE' && cashier.userStatus === 'ACTIVE',
  );
  const supervisors = active.filter((cashier) => cashier.supervisor);
  const tree = useMemo(() => orderTree(categories.data ?? []), [categories.data]);

  const toggle =
    (set: ReadonlySet<number>, update: (next: ReadonlySet<number>) => void) =>
    (id: number, checked: boolean) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      update(next);
    };
  const save = () =>
    void action.run(async () => {
      await mutations.setTillAccess.mutateAsync({
        id: till.id,
        cashierUserIds: [...cashierIds],
        supervisorUserIds: [...supervisorIds],
        categoryIds: [...categoryIds],
      });
      toast.success(t('pos.tills.access.saved', { code: till.code }));
      onClose();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pos.tills.access.title', { name: till.name })}</DialogTitle>
          <DialogDescription>{t('pos.tills.access.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={action.problem ?? problemFromError(cashiers.error ?? categories.error)}
        />
        <div className="grid gap-5 md:grid-cols-3">
          <Group
            title={t('pos.tills.access.cashiers')}
            hint={t('pos.tills.access.cashiersHint')}
            count={cashierIds.size}
          >
            {active.length === 0 ? (
              <Empty>{t('pos.tills.access.noCashiers')}</Empty>
            ) : (
              active.map((cashier) => (
                <Row
                  key={cashier.userId}
                  id={`access-cashier-${cashier.userId}`}
                  label={cashier.fullName}
                  checked={cashierIds.has(cashier.userId)}
                  onChange={(checked) => toggle(cashierIds, setCashierIds)(cashier.userId, checked)}
                />
              ))
            )}
          </Group>
          <Group
            title={t('pos.tills.access.supervisors')}
            hint={t('pos.tills.access.supervisorsHint')}
            count={supervisorIds.size}
          >
            {supervisors.length === 0 ? (
              <Empty>{t('pos.tills.access.noSupervisors')}</Empty>
            ) : (
              supervisors.map((cashier) => (
                <Row
                  key={cashier.userId}
                  id={`access-supervisor-${cashier.userId}`}
                  label={cashier.fullName}
                  checked={supervisorIds.has(cashier.userId)}
                  onChange={(checked) =>
                    toggle(supervisorIds, setSupervisorIds)(cashier.userId, checked)
                  }
                />
              ))
            )}
          </Group>
          <Group
            title={t('pos.tills.access.categories')}
            hint={t('pos.tills.access.categoriesHint')}
            count={categoryIds.size}
          >
            {tree.length === 0 ? (
              <Empty>{t('pos.tills.access.noCategories')}</Empty>
            ) : (
              tree.map((node) => (
                <Row
                  key={node.category.id}
                  id={`access-category-${node.category.id}`}
                  label={node.category.name}
                  depth={node.depth}
                  checked={categoryIds.has(node.category.id)}
                  onChange={(checked) =>
                    toggle(categoryIds, setCategoryIds)(node.category.id, checked)
                  }
                />
              ))
            )}
          </Group>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} pending={mutations.setTillAccess.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The categories as a flat list in tree order, each with its depth. */
function orderTree(categories: readonly Category[]): { category: Category; depth: number }[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parentId) ?? [];
    list.push(category);
    byParent.set(category.parentId, list);
  }
  const out: { category: Category; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const category of (byParent.get(parentId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, 'mn'),
    )) {
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function Group(props: { title: string; hint: string; count: number; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section aria-label={props.title} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[0.9375rem] font-semibold">{props.title}</h3>
        <span className="text-[0.8125rem] text-muted-foreground">
          {props.count === 0
            ? t('pos.tills.access.everyone')
            : t('pos.tills.access.chosen', { count: props.count })}
        </span>
      </div>
      <p className="text-[0.75rem] text-muted-foreground">{props.hint}</p>
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto rounded-lg border border-border/80 p-2">
        {props.children}
      </div>
    </section>
  );
}

function Row(props: {
  id: string;
  label: string;
  depth?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={props.id}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent',
      )}
      style={{ paddingLeft: `${0.375 + (props.depth ?? 0) * 1}rem` }}
    >
      <Checkbox
        id={props.id}
        checked={props.checked}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
      <span className="min-w-0 truncate">{props.label}</span>
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-[0.8125rem] text-muted-foreground">{children}</p>;
}
