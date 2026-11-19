import { KeyRound, Pencil, Plus, Printer, Tag } from 'lucide-react';
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
import { NativeSelect } from '@/components/native-select';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OneTimeCodeDialog } from '@/features/pos/one-time-code-dialog';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  bridgeInstallLine,
  type PrintStation,
  type PrintStationCreateRequest,
  usePrintMutations,
  usePrintStations,
} from './printing-api';

/**
 * The printers' columns: the name and where it is take the room; a tablet's 41rem lets the
 * paper and the last contact go (ADR-0201).
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 10 },
  { key: 'kind', kind: 'text', weight: 1, min: 8 },
  { key: 'where', kind: 'text', weight: 2, min: 9 },
  { key: 'paper', kind: 'code', width: 5.5, drop: 2 },
  { key: 'lastSeen', kind: 'datetime', width: 10, drop: 1 },
  { key: 'online', kind: 'status', width: 8 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 3 },
];

/**
 * «Систем → Принтер» (ADR-0226): the 80 mm printers the staff app prints price labels on. A LAN
 * printer is reached by the server at its address; a printer on a Windows PC by that PC's print
 * bridge, whose key is shown once inside its install line. «Туршилтын шошго» prints a sample.
 */
export function PrintersPage() {
  const { t } = useTranslation();
  const stations = usePrintStations();
  const mutations = usePrintMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<PrintStation | null>(null);
  const [keyFor, setKeyFor] = useState<PrintStation | null>(null);
  const [shown, setShown] = useState<{ name: string; line: string } | null>(null);
  const none = <span className="text-muted-foreground">{t('printing.none')}</span>;

  const showKey = (name: string, key: string) =>
    setShown({ name, line: bridgeInstallLine(window.location.origin, key) });

  const test = (station: PrintStation) => {
    void action.run(async () => {
      const job = await mutations.test.mutateAsync(station.id);
      if (job.status === 'done') toast.success(t('printing.test.done', { name: station.name }));
      else if (job.status === 'failed') {
        toast.warning(
          t('printing.test.failed', {
            reason: t(`errors.${job.error ?? 'PRINTER_OFFLINE'}`, {
              defaultValue: job.error ?? '',
            }),
          }),
        );
      } else toast.info(t('printing.test.waiting'));
    });
  };
  const newKey = (station: PrintStation) => {
    void action
      .run(async () => {
        const made = await mutations.newKey.mutateAsync(station.id);
        if (made.key) showKey(station.name, made.key);
      })
      .then((ok) => {
        if (ok) setKeyFor(null);
      });
  };

  return (
    <div>
      <PageHeader
        title={t('printing.title')}
        description={t('printing.description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('printing.add')}
          </Button>
        }
      />
      <ProblemAlert problem={problemFromError(stations.error) ?? action.problem} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('printing.fields.name')}</TableHead>
              <TableHead>{t('printing.fields.kind')}</TableHead>
              <TableHead>{t('printing.fields.where')}</TableHead>
              <TableHead>{t('printing.fields.paper')}</TableHead>
              <TableHead>{t('printing.fields.lastSeen')}</TableHead>
              <TableHead>{t('printing.fields.online')}</TableHead>
              <SpacerHead />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stations.isPending ? <SkeletonRows columns={8} rows={2} /> : null}
            {(stations.data ?? []).map((station) => (
              <TableRow key={station.id}>
                <TruncateCell text={station.name} />
                <TableCell>{t(`printing.kinds.${station.kind}`)}</TableCell>
                <TruncateCell
                  text={
                    station.kind === 'network'
                      ? `${station.host ?? ''}:${station.port ?? ''}`
                      : (station.printerName ?? t('printing.none'))
                  }
                  className="font-mono"
                />
                <TableCell className="font-mono">
                  {t('printing.paper', { mm: station.widthDots === 384 ? 58 : 80 })}
                </TableCell>
                <TableCell className="font-mono">
                  {station.lastSeenAt ? formatUbMinute(station.lastSeenAt) : none}
                </TableCell>
                <TableCell>
                  {station.status === 'disabled' ? (
                    <Badge variant="secondary">{t('printing.status.disabled')}</Badge>
                  ) : station.online ? (
                    <Badge variant="success">{t('printing.status.online')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('printing.status.offline')}</Badge>
                  )}
                </TableCell>
                <SpacerCell />
                <RowActions>
                  <RowAction
                    label={`${t('printing.test.action')}: ${station.name}`}
                    icon={Tag}
                    disabled={station.status === 'disabled' || mutations.test.isPending}
                    onClick={() => test(station)}
                  />
                  {station.kind === 'bridge' ? (
                    <RowAction
                      label={`${t('printing.newKey')}: ${station.name}`}
                      icon={KeyRound}
                      destructive
                      onClick={() => setKeyFor(station)}
                    />
                  ) : null}
                  <RowAction
                    label={`${t('common.edit')}: ${station.name}`}
                    icon={Pencil}
                    onClick={() => setEditing(station)}
                  />
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!stations.isPending && (stations.data ?? []).length === 0 ? (
          <EmptyState icon={Printer} title={t('printing.empty')} />
        ) : null}
      </ListCard>
      <StationDialog
        open={creating || editing !== null}
        station={editing}
        onClose={() => {
          if (editing) setEditing(null);
          else setCreating(false);
        }}
        onKey={showKey}
      />
      <ConfirmDialog
        open={keyFor !== null}
        title={t('printing.newKey')}
        description={t('printing.newKeyConfirm')}
        confirmLabel={t('printing.newKey')}
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
        title={t('printing.keyTitle')}
        description={t('printing.keyDescription', { name: shown?.name ?? '' })}
        code={shown?.line ?? ''}
        onClose={() => setShown(null)}
      />
    </div>
  );
}

function StationDialog(props: {
  open: boolean;
  station: PrintStation | null;
  onClose: () => void;
  onKey: (name: string, key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      {props.open ? (
        <StationForm station={props.station} onClose={props.onClose} onKey={props.onKey} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

/** A printer: its name, how it is reached, the paper; an existing one can be switched off. */
function StationForm(props: {
  station: PrintStation | null;
  onClose: () => void;
  onKey: (name: string, key: string) => void;
}) {
  const { t } = useTranslation();
  const { station } = props;
  const mutations = usePrintMutations();
  const action = useAction();
  const [key] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(station?.name ?? '');
  const [kind, setKind] = useState<PrintStationCreateRequest['kind']>(station?.kind ?? 'bridge');
  const [host, setHost] = useState(station?.host ?? '');
  const [port, setPort] = useState(String(station?.port ?? 9100));
  const [widthDots, setWidthDots] = useState<576 | 384>(station?.widthDots === 384 ? 384 : 576);
  const [active, setActive] = useState(station?.status !== 'disabled');
  const [checked, setChecked] = useState(false);
  const portNumber = Number.parseInt(port, 10);
  const hostOk = kind !== 'network' || host.trim() !== '';
  const portOk = kind !== 'network' || (portNumber >= 1 && portNumber <= 65535);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!name.trim() || !hostOk || !portOk) return;
    const address =
      kind === 'network' ? { host: host.trim(), port: portNumber } : { host: null, port: null };
    void action
      .run(async () => {
        if (station) {
          await mutations.update.mutateAsync({
            id: station.id,
            name: name.trim(),
            ...(station.kind === 'network' ? address : {}),
            widthDots,
            status: active ? 'active' : 'disabled',
          });
          toast.success(t('printing.saved'));
        } else {
          const made = await mutations.create.mutateAsync({
            key,
            name: name.trim(),
            kind,
            ...address,
            widthDots,
          });
          toast.success(t('printing.created'));
          if (made.key) props.onKey(made.station.name, made.key);
        }
      })
      .then((ok) => {
        if (ok) props.onClose();
      });
  };
  const pending = mutations.create.isPending || mutations.update.isPending;

  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{station ? t('printing.editTitle') : t('printing.add')}</DialogTitle>
        <DialogDescription>{t('printing.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          label={t('printing.fields.name')}
          htmlFor="printer-name"
          error={checked && !name.trim() ? 'validation.required' : undefined}
        >
          <Input
            id="printer-name"
            value={name}
            maxLength={80}
            autoFocus
            placeholder={t('printing.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('printing.fields.kind')}
          htmlFor="printer-kind"
          hint={t(`printing.kindHints.${kind}`)}
        >
          <NativeSelect
            id="printer-kind"
            value={kind}
            disabled={station !== null}
            onChange={(event) => setKind(event.target.value === 'network' ? 'network' : 'bridge')}
          >
            <option value="bridge">{t('printing.kinds.bridge')}</option>
            <option value="network">{t('printing.kinds.network')}</option>
          </NativeSelect>
        </FormField>
        {kind === 'network' ? (
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <FormField
              label={t('printing.fields.host')}
              htmlFor="printer-host"
              error={checked && !hostOk ? 'validation.required' : undefined}
            >
              <Input
                id="printer-host"
                className="font-mono"
                inputMode="url"
                placeholder="192.168.1.106"
                value={host}
                maxLength={253}
                onChange={(event) => setHost(event.target.value)}
              />
            </FormField>
            <FormField
              label={t('printing.fields.port')}
              htmlFor="printer-port"
              error={checked && !portOk ? 'validation.required' : undefined}
            >
              <Input
                id="printer-port"
                className="font-mono"
                inputMode="numeric"
                value={port}
                maxLength={5}
                onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          </div>
        ) : null}
        <FormField label={t('printing.fields.paper')} htmlFor="printer-paper">
          <NativeSelect
            id="printer-paper"
            value={String(widthDots)}
            onChange={(event) => setWidthDots(event.target.value === '384' ? 384 : 576)}
          >
            <option value="576">{t('printing.paper', { mm: 80 })}</option>
            <option value="384">{t('printing.paper', { mm: 58 })}</option>
          </NativeSelect>
        </FormField>
        {station ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/90 px-3.5 py-2.5">
            <Label htmlFor="printer-active" className="font-normal">
              {t('printing.fields.active')}
            </Label>
            <Switch id="printer-active" checked={active} onCheckedChange={setActive} />
          </div>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={props.onClose} />
      </form>
    </DialogContent>
  );
}
