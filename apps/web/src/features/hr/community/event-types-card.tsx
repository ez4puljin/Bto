import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { Archive, ArchiveRestore, CalendarDays, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type HrEventType, useEngagementMutations, useHrEventTypes } from '../engagement-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'events', kind: 'count', width: 6 },
  { key: 'actions', kind: 'actions', actions: 2 },
];

/** A new type's colour until HR picks another; a colour the input can show (`#rrggbb`). */
const DEFAULT_COLOR = '#64748b';

/** «Шинэ төрөл» / «Төрөл засах»: mounted while open, so it starts from the row each time. */
function EventTypeDialog(props: { type: HrEventType | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { saveEventType } = useEngagementMutations();
  const action = useAction();
  const { type } = props;
  const [name, setName] = useState(type?.name ?? '');
  const [color, setColor] = useState(type?.color ?? DEFAULT_COLOR);
  const [tried, setTried] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (name.trim() === '') return;
    const ok = await action.run(() =>
      saveEventType.mutateAsync({ id: type?.id ?? null, name: name.trim(), color }),
    );
    if (ok) {
      toast.success(t(type ? 'hr.setup.eventTypes.saved' : 'hr.setup.eventTypes.created'));
      props.onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>
            {t(type ? 'hr.setup.eventTypes.edit' : 'hr.setup.eventTypes.create')}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('hr.setup.eventTypes.name')}
            htmlFor="event-type-name"
            error={tried && name.trim() === '' ? 'validation.required' : undefined}
          >
            <Input
              id="event-type-name"
              autoComplete="off"
              maxLength={ENGAGEMENT_LIMITS.maxEventTypeName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label={t('hr.setup.eventTypes.color')} htmlFor="event-type-color">
            <Input
              id="event-type-color"
              type="color"
              className="h-10 w-16 p-1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={saveEventType.isPending}
            onCancel={props.onClose}
            submitLabel={type ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Календарийн төрөл» (ADR-0171): HR's own list. An archived type leaves the event dialog and the
 * legend, and stays on the events that hold it.
 */
export function EventTypesCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const types = useHrEventTypes(showArchived);
  const { archiveEventType } = useEngagementMutations();
  const action = useAction();
  const [editing, setEditing] = useState<HrEventType | 'new' | null>(null);
  const toggleArchived = async (type: HrEventType) => {
    const archived = type.archivedAt === null;
    const ok = await action.run(() => archiveEventType.mutateAsync({ id: type.id, archived }));
    if (ok) {
      toast.success(
        t(archived ? 'hr.setup.eventTypes.archivedToast' : 'hr.setup.eventTypes.restoredToast'),
      );
    }
  };
  return (
    <Card role="region" aria-label={t('hr.setup.eventTypes.title')}>
      <CardHeader>
        <CardTitle>{t('hr.setup.eventTypes.title')}</CardTitle>
        <CardDescription>{t('hr.setup.eventTypes.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterToggle
            label={t('hr.setup.eventTypes.showArchived')}
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          {canManage ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus />
              {t('hr.setup.eventTypes.create')}
            </Button>
          ) : null}
        </div>
        <ProblemAlert
          problem={action.problem ?? problemFromError(types.error)}
          onRetry={action.problem ? undefined : types.refetch}
        />
        <ListCard>
          {types.data && types.data.length === 0 ? (
            <EmptyState title={t('hr.setup.eventTypes.empty')} icon={CalendarDays} />
          ) : (
            <ListTable columns={COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.setup.eventTypes.name')}</TableHead>
                  <TableHead className="text-right">{t('hr.setup.eventTypes.events')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.isPending ? <SkeletonRows columns={3} /> : null}
                {(types.data ?? []).map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: type.color }}
                        />
                        <span className="truncate">{type.name}</span>
                        {type.archivedAt ? (
                          <Badge variant="outline">{t('hr.setup.eventTypes.archived')}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{type.events}</TableCell>
                    <RowActions>
                      {canManage ? (
                        <>
                          <RowAction
                            label={t('hr.setup.eventTypes.editFor', { name: type.name })}
                            icon={Pencil}
                            onClick={() => setEditing(type)}
                          />
                          <RowAction
                            label={t(
                              type.archivedAt
                                ? 'hr.setup.eventTypes.restoreFor'
                                : 'hr.setup.eventTypes.archiveFor',
                              { name: type.name },
                            )}
                            icon={type.archivedAt ? ArchiveRestore : Archive}
                            destructive={type.archivedAt === null}
                            disabled={archiveEventType.isPending}
                            onClick={() => void toggleArchived(type)}
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
        {canManage && editing !== null ? (
          <EventTypeDialog
            key={editing === 'new' ? 'new' : editing.id}
            type={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
