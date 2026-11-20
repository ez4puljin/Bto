import { KeyRound, Pencil, Phone, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { OneTimeCodeDialog } from '@/features/pos/one-time-code-dialog';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  callBridgeInstallLine,
  type PhoneLine,
  usePhoneLineMutations,
  usePhoneLines,
} from './phone-agent-api';
import { badDays, draftOf, scheduleOf } from './schedule';
import { ScheduleEditor } from './schedule-editor';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 10 },
  { key: 'lastSeen', kind: 'datetime', width: 10, drop: 1 },
  { key: 'online', kind: 'status', width: 8, drop: 2 },
  { key: 'active', kind: 'status', width: 7 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

const GREETING_MAX = 500;

/**
 * «Систем → Утасны AI шугам» (ADR-0232): the phone lines the AI answers outside the shop's working
 * hours. A line's key is shown once, inside the install line of the Windows call bridge.
 */
export function PhoneLinesPage() {
  const { t } = useTranslation();
  const lines = usePhoneLines();
  const mutations = usePhoneLineMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<PhoneLine | null>(null);
  const [keyFor, setKeyFor] = useState<PhoneLine | null>(null);
  const [shown, setShown] = useState<{ name: string; line: string } | null>(null);
  const none = <span className="text-muted-foreground">{t('phoneAgent.lines.none')}</span>;

  const showKey = (name: string, key: string) =>
    setShown({ name, line: callBridgeInstallLine(window.location.origin, key) });

  const toggle = (line: PhoneLine, active: boolean) => {
    void action.run(async () => {
      await mutations.update.mutateAsync({ id: line.id, active });
      toast.success(t(active ? 'phoneAgent.lines.turnedOn' : 'phoneAgent.lines.turnedOff'));
    });
  };
  const newKey = (line: PhoneLine) => {
    void action
      .run(async () => {
        const made = await mutations.newKey.mutateAsync(line.id);
        showKey(line.name, made.key);
      })
      .then((ok) => {
        if (ok) setKeyFor(null);
      });
  };

  return (
    <div>
      <PageHeader
        title={t('phoneAgent.lines.title')}
        description={t('phoneAgent.lines.description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('phoneAgent.lines.add')}
          </Button>
        }
      />
      <ProblemAlert problem={problemFromError(lines.error) ?? action.problem} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phoneAgent.lines.fields.name')}</TableHead>
              <TableHead>{t('phoneAgent.lines.fields.lastSeen')}</TableHead>
              <TableHead>{t('phoneAgent.lines.fields.online')}</TableHead>
              <TableHead>{t('phoneAgent.lines.fields.active')}</TableHead>
              <SpacerHead />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.isPending ? <SkeletonRows columns={6} rows={2} /> : null}
            {(lines.data ?? []).map((line) => (
              <TableRow key={line.id}>
                <TruncateCell text={line.name} />
                <TableCell className="font-mono">
                  {line.lastSeenAt ? formatUbMinute(line.lastSeenAt) : none}
                </TableCell>
                <TableCell>
                  {line.online ? (
                    <Badge variant="success">{t('phoneAgent.lines.online')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('phoneAgent.lines.offline')}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    aria-label={`${t('phoneAgent.lines.switch')}: ${line.name}`}
                    checked={line.active}
                    disabled={mutations.update.isPending}
                    onCheckedChange={(next) => toggle(line, next)}
                  />
                </TableCell>
                <SpacerCell />
                <RowActions>
                  <RowAction
                    label={`${t('phoneAgent.lines.newKey')}: ${line.name}`}
                    icon={KeyRound}
                    destructive
                    onClick={() => setKeyFor(line)}
                  />
                  <RowAction
                    label={`${t('common.edit')}: ${line.name}`}
                    icon={Pencil}
                    onClick={() => setEditing(line)}
                  />
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!lines.isPending && (lines.data ?? []).length === 0 ? (
          <EmptyState icon={Phone} title={t('phoneAgent.lines.empty')} />
        ) : null}
      </ListCard>
      <LineDialog
        open={creating || editing !== null}
        line={editing}
        onClose={() => {
          if (editing) setEditing(null);
          else setCreating(false);
        }}
        onKey={showKey}
      />
      <ConfirmDialog
        open={keyFor !== null}
        title={t('phoneAgent.lines.newKey')}
        description={t('phoneAgent.lines.newKeyConfirm')}
        confirmLabel={t('phoneAgent.lines.newKey')}
        variant="destructive"
        pending={mutations.newKey.isPending}
        problem={action.problem}
        onConfirm={() => {
          if (keyFor) newKey(keyFor);
        }}
        onClose={() => setKeyFor(null)}
      />
      <OneTimeCodeDialog
        open={shown !== null}
        title={t('phoneAgent.lines.keyTitle')}
        description={t('phoneAgent.lines.keyDescription', { name: shown?.name ?? '' })}
        code={shown?.line ?? ''}
        onClose={() => setShown(null)}
      />
    </div>
  );
}

function LineDialog(props: {
  open: boolean;
  line: PhoneLine | null;
  onClose: () => void;
  onKey: (name: string, key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      {props.open ? (
        <LineForm line={props.line} onClose={props.onClose} onKey={props.onKey} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

/** A line: its name, the working hours and the greeting; the on/off switch is on the list. */
function LineForm(props: {
  line: PhoneLine | null;
  onClose: () => void;
  onKey: (name: string, key: string) => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const mutations = usePhoneLineMutations();
  const action = useAction();
  const [key] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(line?.name ?? '');
  const [draft, setDraft] = useState(() => draftOf(line?.schedule));
  const [greeting, setGreeting] = useState(line?.greeting ?? '');
  const [checked, setChecked] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!name.trim() || badDays(draft).length > 0) return;
    const body = {
      name: name.trim(),
      schedule: scheduleOf(draft),
      greeting: greeting.trim() === '' ? null : greeting.trim(),
    };
    void action
      .run(async () => {
        if (line) {
          await mutations.update.mutateAsync({ id: line.id, ...body });
          toast.success(t('phoneAgent.lines.saved'));
        } else {
          const made = await mutations.create.mutateAsync({ key, ...body });
          toast.success(t('phoneAgent.lines.created'));
          props.onKey(made.line.name, made.key);
        }
      })
      .then((ok) => {
        if (ok) props.onClose();
      });
  };
  const pending = mutations.create.isPending || mutations.update.isPending;

  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <DialogHeader>
        <DialogTitle>
          {line ? t('phoneAgent.lines.editTitle') : t('phoneAgent.lines.add')}
        </DialogTitle>
        <DialogDescription>{t('phoneAgent.lines.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          label={t('phoneAgent.lines.fields.name')}
          htmlFor="phone-line-name"
          error={checked && !name.trim() ? 'validation.required' : undefined}
        >
          <Input
            id="phone-line-name"
            value={name}
            maxLength={60}
            autoFocus
            placeholder={t('phoneAgent.lines.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <ScheduleEditor draft={draft} onChange={setDraft} checked={checked} />
        <FormField
          label={t('phoneAgent.lines.fields.greeting')}
          htmlFor="phone-line-greeting"
          hint={t('phoneAgent.lines.greetingHint')}
        >
          <Textarea
            id="phone-line-greeting"
            rows={3}
            value={greeting}
            maxLength={GREETING_MAX}
            onChange={(event) => setGreeting(event.target.value)}
          />
        </FormField>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={props.onClose} />
      </form>
    </DialogContent>
  );
}
