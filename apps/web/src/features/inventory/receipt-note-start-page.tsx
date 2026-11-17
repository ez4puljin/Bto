import {
  FileText,
  FileUp,
  LoaderCircle,
  ScanLine,
  ScanText,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { EmptyState, ListCard } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SupplierSelect } from '@/features/partners/party-select';
import type { PickedSupplier } from '@/features/partners/supplier-picker';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { scanFailureKeyOf } from './receipt-note-review';
import { NoteScannersDialog } from './receipt-note-scanners';
import {
  isReading,
  type NoteReadingSummary,
  type ScanSource,
  useNoteMutations,
  useNoteStatus,
  useOpenNoteReadings,
} from './receipt-notes-api';

/** As the server takes them: photos, sheets and PDF files, twelve pages of ten megabytes at most. */
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_PAGES = 12;
const MAX_BYTES = 10 * 1024 * 1024;

/** A page waiting to be read: a file chosen here, or a sheet the scanner made. */
interface PendingPage {
  key: string;
  fileId: number;
  name: string;
  /** A picture to show; null for a PDF file. */
  preview: string | null;
}

/**
 * «Падаан унших» (ADR-0210): the pages of one supplier's delivery note are gathered here, from
 * files or straight from a scanner of the building, and given to the model with «Унших». The
 * reading goes on in the background, so the next note can be gathered at once; the list below
 * shows what is being read and what waits to be checked.
 */
export function ReceiptNoteStartPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const canSetup = useHasPermission('inventory.setup.manage');
  const status = useNoteStatus();
  const open = useOpenNoteReadings();
  const mutations = useNoteMutations();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [pages, setPages] = useState<PendingPage[]>([]);
  const [busy, setBusy] = useState<'upload' | 'scan' | 'start' | null>(null);
  const [scannerId, setScannerId] = useState<number | null>(null);
  const [source, setSource] = useState<ScanSource>('GLASS');
  const [refused, setRefused] = useState<'tooMany' | 'tooLarge' | null>(null);
  const [setup, setSetup] = useState(false);
  const startKey = useRef(randomUuid());

  const scanners = status.data?.scanners ?? [];
  const scanner = scanners.find((entry) => entry.id === scannerId) ?? scanners[0] ?? null;
  const room = MAX_PAGES - pages.length;

  // Object URLs of the previews live as long as the page.
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const addFiles = (files: File[]) => {
    setRefused(null);
    if (files.length === 0) return;
    if (files.length > room) setRefused('tooMany');
    const taken = files.slice(0, room);
    if (taken.some((file) => file.size > MAX_BYTES)) {
      setRefused('tooLarge');
      return;
    }
    setBusy('upload');
    void action
      .run(async () => {
        for (const file of taken) {
          const fileId = await uploadFile(api, 'inventory.note_page', file);
          let preview: string | null = null;
          if (file.type !== 'application/pdf') {
            preview = URL.createObjectURL(file);
            urls.current.push(preview);
          }
          setPages((before) => [
            ...before,
            { key: `f${fileId}`, fileId, name: file.name, preview },
          ]);
        }
      })
      .finally(() => setBusy(null));
  };

  const scan = () => {
    if (scanner === null) return;
    setRefused(null);
    setBusy('scan');
    void action
      .run(async () => {
        const result = await mutations.scan.mutateAsync({ scannerId: scanner.id, source });
        const sheets = result.sheets.slice(0, room);
        if (result.sheets.length > room) setRefused('tooMany');
        setPages((before) => [
          ...before,
          ...sheets.map((sheet, index) => ({
            key: `s${sheet.fileId}`,
            fileId: sheet.fileId,
            name: t('inventory.noteReading.sheet', { number: before.length + index + 1 }),
            preview: `data:image/jpeg;base64,${sheet.preview}`,
          })),
        ]);
      })
      .finally(() => setBusy(null));
  };

  const start = () => {
    setBusy('start');
    void action
      .run(async () => {
        await mutations.start.mutateAsync({
          key: startKey.current,
          fileIds: pages.map((page) => page.fileId),
          supplierId: supplier?.id ?? null,
        });
        // The next note is a new intent; this one reads on in the list below.
        startKey.current = randomUuid();
        setPages([]);
        setSupplier(null);
      })
      .finally(() => setBusy(null));
  };

  // A scanner's refusal says why in its own words (paper, busy, wrong address).
  const scanFailure =
    action.problem?.code === 'SCANNER_FAILED'
      ? scanFailureKeyOf(action.problem.params?.reason)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('inventory.noteReading.title')}
        description={t('inventory.noteReading.description')}
        crumbs={[{ label: t('inventory.receipts.title'), to: '/inventory/receipts' }]}
        actions={
          canSetup ? (
            <Button variant="outline" onClick={() => setSetup(true)}>
              <Settings2 />
              {t('inventory.noteReading.scanners.open')}
            </Button>
          ) : null
        }
      />
      {status.data && !status.data.read ? (
        <Alert>
          <Sparkles />
          <AlertDescription>
            {t('inventory.noteReading.notConfigured')}{' '}
            <Link to="/settings?tab=ai" className="underline underline-offset-4">
              {t('inventory.noteReading.toSettings')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {scanFailure ? (
        <Alert variant="destructive">
          <ScanLine />
          <AlertDescription>{t(scanFailure)}</AlertDescription>
        </Alert>
      ) : (
        <ProblemAlert problem={action.problem ?? problemFromError(status.error)} />
      )}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 @container sm:grid-cols-[minmax(0,22rem)_1fr]">
            <FormField label={t('inventory.noteReading.supplier')} htmlFor="note-supplier">
              <SupplierSelect id="note-supplier" value={supplier} onChange={setSupplier} />
            </FormField>
            <div className="flex flex-wrap items-end gap-2">
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                aria-label={t('inventory.noteReading.addFiles')}
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
              <Button
                variant="outline"
                disabled={busy !== null || room <= 0}
                onClick={() => input.current?.click()}
              >
                {busy === 'upload' ? <LoaderCircle className="animate-spin" /> : <FileUp />}
                {t('inventory.noteReading.addFiles')}
              </Button>
              {scanner ? (
                <>
                  {scanners.length > 1 ? (
                    <NativeSelect
                      aria-label={t('inventory.noteReading.scanner')}
                      value={String(scanner.id)}
                      onChange={(event) => setScannerId(Number.parseInt(event.target.value, 10))}
                    >
                      {scanners.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  <NativeSelect
                    aria-label={t('inventory.noteReading.source.label')}
                    value={source}
                    onChange={(event) =>
                      setSource(event.target.value === 'FEEDER' ? 'FEEDER' : 'GLASS')
                    }
                  >
                    <option value="GLASS">{t('inventory.noteReading.source.GLASS')}</option>
                    <option value="FEEDER">{t('inventory.noteReading.source.FEEDER')}</option>
                  </NativeSelect>
                  <Button variant="outline" disabled={busy !== null || room <= 0} onClick={scan}>
                    {busy === 'scan' ? <LoaderCircle className="animate-spin" /> : <ScanLine />}
                    {t(
                      busy === 'scan'
                        ? 'inventory.noteReading.scanning'
                        : pages.length > 0
                          ? 'inventory.noteReading.scanMore'
                          : 'inventory.noteReading.scan',
                    )}
                  </Button>
                </>
              ) : null}
              <Button
                disabled={busy !== null || pages.length === 0 || status.data?.read !== true}
                onClick={start}
              >
                {busy === 'start' ? <LoaderCircle className="animate-spin" /> : <ScanText />}
                {t('inventory.noteReading.read')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('inventory.noteReading.supplierHint')}</p>
          {status.data && scanners.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                canSetup
                  ? 'inventory.noteReading.noScannerSetup'
                  : 'inventory.noteReading.noScanner',
              )}
            </p>
          ) : null}
          {refused ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`inventory.noteReading.refused.${refused}`, { max: MAX_PAGES })}
            </p>
          ) : null}
          {pages.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t('inventory.noteReading.noPages')}
            </p>
          ) : (
            <ul aria-label={t('inventory.noteReading.pages')} className="flex flex-wrap gap-3">
              {pages.map((page, index) => (
                <li
                  key={page.key}
                  className="relative flex w-28 flex-col items-center gap-1 rounded-lg border border-border bg-card p-1.5"
                >
                  {page.preview ? (
                    <img
                      src={page.preview}
                      alt={page.name}
                      className="h-32 w-full rounded object-cover"
                    />
                  ) : (
                    <span className="grid h-32 w-full place-items-center rounded bg-fill text-muted-foreground">
                      <FileText aria-hidden className="size-8" />
                    </span>
                  )}
                  <span className="w-full truncate text-center text-xs text-muted-foreground">
                    {t('inventory.noteReading.pageNo', { number: index + 1 })}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="absolute -top-2 -right-2 rounded-full"
                    aria-label={t('inventory.noteReading.removePage', { number: index + 1 })}
                    disabled={busy !== null}
                    onClick={() =>
                      setPages((before) => before.filter((entry) => entry.key !== page.key))
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <h2 className="mt-2 text-sm font-medium">{t('inventory.noteReading.openTitle')}</h2>
      <ProblemAlert problem={problemFromError(open.error)} onRetry={open.refetch} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.noteReading.columns.supplier')}</TableHead>
              <TableHead className="text-right">
                {t('inventory.noteReading.columns.pages')}
              </TableHead>
              <TableHead className="text-right">
                {t('inventory.noteReading.columns.lines')}
              </TableHead>
              <TableHead>{t('inventory.noteReading.columns.by')}</TableHead>
              <TableHead>{t('inventory.noteReading.columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(open.data ?? []).map((reading) => (
              <TableRow
                key={reading.id}
                className="cursor-pointer"
                onClick={() => void navigate(`/inventory/receipts/notes/${reading.id}`)}
              >
                <TableCell>
                  <Link
                    to={`/inventory/receipts/notes/${reading.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {reading.supplierName ?? t('inventory.noteReading.unknownSupplier')}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono">{reading.pageCount}</TableCell>
                <TableCell className="text-right font-mono">
                  {reading.lineCount ?? t('common.none')}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {reading.createdByName ?? t('common.none')}
                  {' · '}
                  {formatUbMinute(reading.createdAt)}
                </TableCell>
                <TableCell>
                  <NoteStatusBadge reading={reading} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {open.data?.length === 0 ? (
          <EmptyState icon={ScanText} title={t('inventory.noteReading.openEmpty')} />
        ) : null}
      </ListCard>
      <Dialog open={setup} onOpenChange={setSetup}>
        {setup ? <NoteScannersDialog onClose={() => setSetup(false)} /> : null}
      </Dialog>
    </div>
  );
}

/** Where a reading stands, in a pill; «уншиж байна» turns while the model works. */
export function NoteStatusBadge(props: { reading: Pick<NoteReadingSummary, 'status' | 'stale'> }) {
  const { t } = useTranslation();
  const { reading } = props;
  if (isReading(reading)) {
    return (
      <Badge variant="outline">
        <LoaderCircle aria-hidden className="animate-spin" />
        {t('inventory.noteReading.status.READING')}
      </Badge>
    );
  }
  const failed = reading.status === 'FAILED' || reading.status === 'READING';
  return (
    <Badge variant={failed ? 'warning' : reading.status === 'READY' ? 'default' : 'outline'}>
      {t(`inventory.noteReading.status.${failed ? 'FAILED' : reading.status}`)}
    </Badge>
  );
}
