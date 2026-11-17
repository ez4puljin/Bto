import { CircleCheck, LoaderCircle, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { scanFailureKeyOf } from './receipt-note-review';
import {
  type NoteScanner,
  type NoteScannerCheck,
  useNoteMutations,
  useNoteScanners,
} from './receipt-notes-api';

/**
 * The building's scanners (ADR-0210, the setup right): a name and the device's address on the
 * local network. «Шалгах» asks the device what it is before it is saved; a scanner switched off is
 * offered to nobody and keeps its row.
 */
export function NoteScannersDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const scanners = useNoteScanners();
  const [editing, setEditing] = useState<NoteScanner | 'new' | null>(null);
  return (
    <DialogContent size="md" closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t('inventory.noteReading.scanners.title')}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{t('inventory.noteReading.scanners.about')}</p>
      <ProblemAlert problem={problemFromError(scanners.error)} />
      <ul className="flex flex-col gap-2">
        {(scanners.data ?? []).map((scanner) => (
          <li
            key={scanner.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{scanner.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{scanner.url}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {scanner.active ? null : (
                <Badge variant="outline">{t('inventory.noteReading.scanners.off')}</Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => setEditing(scanner)}>
                {t('common.edit')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {scanners.data?.length === 0 && editing === null ? (
        <p className="text-sm text-muted-foreground">{t('inventory.noteReading.scanners.empty')}</p>
      ) : null}
      {editing === null ? (
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus />
            {t('inventory.noteReading.scanners.add')}
          </Button>
          <Button variant="outline" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <ScannerForm
          key={editing === 'new' ? 'new' : editing.id}
          scanner={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
    </DialogContent>
  );
}

function ScannerForm(props: { scanner: NoteScanner | null; onDone: () => void }) {
  const { t } = useTranslation();
  const mutations = useNoteMutations();
  const action = useAction();
  const [name, setName] = useState(props.scanner?.name ?? '');
  const [url, setUrl] = useState(props.scanner?.url ?? '');
  const [active, setActive] = useState(props.scanner?.active ?? true);
  const [check, setCheck] = useState<NoteScannerCheck | null>(null);
  const ready = name.trim() !== '' && url.trim() !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    void action.run(async () => {
      await mutations.saveScanner.mutateAsync({
        id: props.scanner?.id ?? null,
        body: { name: name.trim(), url: url.trim(), active },
      });
      props.onDone();
    });
  };
  const test = () => {
    setCheck(null);
    void action.run(async () => setCheck(await mutations.checkScanner.mutateAsync(url.trim())));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <ProblemAlert problem={action.problem} />
      <FormField label={t('inventory.noteReading.scanners.name')} htmlFor="scanner-name">
        <Input
          id="scanner-name"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField
        label={t('inventory.noteReading.scanners.url')}
        htmlFor="scanner-url"
        hint={t('inventory.noteReading.scanners.urlHint')}
      >
        <Input
          id="scanner-url"
          value={url}
          maxLength={200}
          inputMode="url"
          className="font-mono"
          placeholder="192.168.1.60"
          onChange={(event) => {
            setUrl(event.target.value);
            setCheck(null);
          }}
        />
      </FormField>
      {check ? (
        <p
          role="status"
          className={
            check.ok ? 'flex items-center gap-1.5 text-sm text-success' : 'text-sm text-destructive'
          }
        >
          {check.ok ? <CircleCheck aria-hidden className="size-4" /> : null}
          {check.ok
            ? t(
                check.feeder
                  ? 'inventory.noteReading.scanners.checkOkFeeder'
                  : 'inventory.noteReading.scanners.checkOk',
                { model: check.model ?? t('inventory.noteReading.scanners.unnamed') },
              )
            : t(scanFailureKeyOf(check.reason))}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={active} onCheckedChange={setActive} />
        {t('inventory.noteReading.scanners.active')}
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={url.trim() === '' || mutations.checkScanner.isPending}
          onClick={test}
        >
          {mutations.checkScanner.isPending ? <LoaderCircle className="animate-spin" /> : null}
          {t('inventory.noteReading.scanners.check')}
        </Button>
        <Button type="button" variant="outline" onClick={props.onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!ready || mutations.saveScanner.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
