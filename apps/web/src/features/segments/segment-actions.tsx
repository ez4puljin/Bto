import { MAX_SEGMENT_DESCRIPTION, MAX_SEGMENT_NAME } from '@tugeel/shared/segments';
import { ChevronDown, Shapes } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCount } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type Segment, useSegmentLists, useSegments } from './api';

type Action = 'create' | 'add' | 'remove';

/**
 * The selection bar's «Сегмент» menu (ADR-0052), for `segments.manage`: a hand-picked segment of
 * the ticked products, the ticked products added to one, or taken out of the one the list is
 * filtered by. Each opens a dialog with one Idempotency-Key; afterwards a toast says what changed
 * and the ticks clear.
 */
export function SegmentActions(props: {
  ids: readonly number[];
  /** The segment the list is filtered by, if any. */
  segmentId?: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const segments = useSegments('PRODUCT');
  const lists = (segments.data ?? []).filter((segment) => segment.kind === 'LIST');
  const current = lists.find((segment) => segment.id === props.segmentId);
  const [open, setOpen] = useState<Action | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(null);
    // The menu item is gone by the time a dialog closes: the focus goes back to «Сегмент».
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  const done = () => {
    setOpen(null);
    props.onDone();
  };
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="outline" size="sm">
            <Shapes />
            {t('segments.list.menu')}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setOpen('create')}>
            {t('segments.list.create')}
          </DropdownMenuItem>
          {lists.length > 0 ? (
            <DropdownMenuItem onSelect={() => setOpen('add')}>
              {t('segments.list.add')}
            </DropdownMenuItem>
          ) : null}
          {current ? (
            <DropdownMenuItem onSelect={() => setOpen('remove')}>
              {t('segments.list.remove')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'create' ? <CreateDialog ids={props.ids} onClose={close} onDone={done} /> : null}
      {open === 'add' ? (
        <AddDialog ids={props.ids} lists={lists} onClose={close} onDone={done} />
      ) : null}
      {open === 'remove' && current ? (
        <RemoveDialog ids={props.ids} segment={current} onClose={close} onDone={done} />
      ) : null}
    </>
  );
}

interface DialogProps {
  ids: readonly number[];
  onClose: () => void;
  onDone: () => void;
}

/** A toast saying what a change of members did: changed, and already so (or not in it). */
function useMembersReport() {
  const { t } = useTranslation();
  return (kind: 'add' | 'remove', result: { changed: number; unchanged: number }) => {
    const parts = [
      t(kind === 'add' ? 'segments.list.added' : 'segments.list.removed', {
        changed: formatCount(result.changed),
      }),
    ];
    if (result.unchanged > 0) {
      parts.push(
        t(kind === 'add' ? 'segments.list.alreadyIn' : 'segments.list.notIn', {
          unchanged: formatCount(result.unchanged),
        }),
      );
    }
    toast.success(parts.join('. '));
  };
}

/** Name and description; the new segment's page opens afterwards. */
function CreateDialog({ ids, onClose, onDone }: DialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lists = useSegmentLists();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const nameMissing = submitted && name.trim() === '';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === '') return;
    let id = 0;
    const ok = await action.run(async () => {
      id = (
        await lists.create.mutateAsync({
          key,
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
          productIds: [...ids],
        })
      ).id;
    });
    if (ok) {
      toast.success(t('segments.list.created'));
      onDone();
      void navigate(`/segments/${id}`);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('segments.list.createTitle')}</DialogTitle>
          <DialogDescription>
            {t('segments.list.count', { total: formatCount(ids.length) })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <FormField
            label={t('segments.name')}
            htmlFor="list-name"
            error={nameMissing ? 'validation.required' : undefined}
          >
            <Input
              id="list-name"
              maxLength={MAX_SEGMENT_NAME}
              aria-invalid={nameMissing || undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label={t('segments.description')} htmlFor="list-description">
            <Textarea
              id="list-description"
              rows={2}
              maxLength={MAX_SEGMENT_DESCRIPTION}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={lists.create.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog(props: DialogProps & { lists: readonly Segment[] }) {
  const { t } = useTranslation();
  const lists = useSegmentLists();
  const action = useAction();
  const report = useMembersReport();
  const [key] = useState(randomUuid);
  const [segmentId, setSegmentId] = useState<number | undefined>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (segmentId === undefined) return;
    let result: { changed: number; unchanged: number } | undefined;
    if (
      await action.run(async () => {
        result = await lists.add.mutateAsync({ key, id: segmentId, productIds: [...props.ids] });
      })
    ) {
      if (result) report('add', result);
      props.onDone();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('segments.list.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('segments.list.count', { total: formatCount(props.ids.length) })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <FormField label={t('segments.list.segment')} htmlFor="list-segment">
            <NativeSelect
              id="list-segment"
              value={segmentId === undefined ? '' : String(segmentId)}
              onChange={(event) =>
                setSegmentId(
                  event.target.value ? Number.parseInt(event.target.value, 10) : undefined,
                )
              }
            >
              <option value="">{t('segments.list.chooseSegment')}</option>
              {props.lists.map((segment) => (
                <option key={segment.id} value={String(segment.id)}>
                  {segment.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={lists.add.isPending || segmentId === undefined}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog(props: DialogProps & { segment: Segment }) {
  const { t } = useTranslation();
  const lists = useSegmentLists();
  const action = useAction();
  const report = useMembersReport();
  const [key] = useState(randomUuid);
  const confirm = async () => {
    let result: { changed: number; unchanged: number } | undefined;
    if (
      await action.run(async () => {
        result = await lists.remove.mutateAsync({
          key,
          id: props.segment.id,
          productIds: [...props.ids],
        });
      })
    ) {
      if (result) report('remove', result);
      props.onDone();
    }
  };
  return (
    <ConfirmDialog
      open
      title={t('segments.list.removeTitle', { total: formatCount(props.ids.length) })}
      description={t('segments.list.removeHint', { name: props.segment.name })}
      confirmLabel={t('segments.list.remove')}
      variant="destructive"
      pending={lists.remove.isPending}
      problem={action.problem}
      onConfirm={() => void confirm()}
      onClose={props.onClose}
    />
  );
}
