import type { ProblemDetails } from '@tugeel/api-client';
import { normalizeBinCode } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { Minus, Plus, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FilterToggle } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBarcodeLookup } from '@/features/catalog/api';
import { ApiProblem, problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type StocktakeBin,
  type StocktakeDetail,
  type StocktakeLine,
  type StocktakeScanResult,
  useStocktakeBinLines,
  useStocktakeMutations,
} from './api';
import { looksLikeLabel, parseCount, parseScanQty } from './helpers';
import { useScanQty } from './scan-qty';
import { ProductSearch, ScanQtyField, ScanToolbar } from './shared';

/** Shelves shown at once; the rest are reached by scanning their label. */
const SHELVES_SHOWN = 300;

const signed = (value: string) => (value.startsWith('-') ? value : `+${value}`);

interface ScanUnit {
  /** The product unit counted. */
  id: number;
}

interface PendingScan {
  /** Idempotency-Key: the same scan sent again counts once. */
  key: string;
  binId: number;
  qty: string;
  /** A scanned barcode, resolved when its turn comes; or the unit itself. */
  code?: string;
  unit?: ScanUnit;
}

type Feedback =
  | { tone: 'ok'; text: string; undo?: PendingScan }
  | { tone: 'error'; text: string }
  | { tone: 'problem'; problem: ProblemDetails }
  | null;

/**
 * Scans reach the server one at a time, each with its own Idempotency-Key. A scan that never got
 * an answer (no network) waits, key and all, for «Дахин илгээх»: sent again it counts once.
 */
function useScanQueue(
  stocktakeId: number,
  onCounted: (result: StocktakeScanResult, scan: PendingScan & { unit: ScanUnit }) => void,
  onFailed: (feedback: Feedback) => void,
) {
  const { t } = useTranslation();
  const mutations = useStocktakeMutations();
  const lookup = useBarcodeLookup();
  const units = useRef(new Map<string, ScanUnit | null>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const handlers = useRef({ onCounted, onFailed });
  const [pending, setPending] = useState(0);
  const [unsent, setUnsent] = useState<PendingScan[]>([]);
  useEffect(() => {
    handlers.current = { onCounted, onFailed };
  });

  /** The unit of a barcode, remembered for the page; null for an unknown code. */
  const resolve = async (code: string): Promise<ScanUnit | null> => {
    const known = units.current.get(code);
    if (known !== undefined) return known;
    try {
      const found = await lookup.mutateAsync(code);
      const unit = { id: found.unit.id };
      units.current.set(code, unit);
      return unit;
    } catch (error) {
      if (error instanceof ApiProblem && error.problem.code === 'NOT_FOUND') {
        units.current.set(code, null);
        return null;
      }
      throw error;
    }
  };

  const send = async (scan: PendingScan, again = false): Promise<void> => {
    try {
      const unit = scan.unit ?? (scan.code === undefined ? null : await resolve(scan.code));
      if (!unit) {
        const code = scan.code ?? '';
        handlers.current.onFailed({
          tone: 'error',
          text: looksLikeLabel(code)
            ? t('inventory.stocktake.binNotInCount', { code: normalizeBinCode(code) })
            : t('inventory.stocktake.unknownCode', { code }),
        });
        return;
      }
      const result = await mutations.scan.mutateAsync({
        id: stocktakeId,
        key: scan.key,
        binId: scan.binId,
        productUnitId: unit.id,
        qty: scan.qty,
      });
      handlers.current.onCounted(result, { ...scan, unit });
    } catch (error) {
      if (!(error instanceof ApiProblem) || error.problem.code === 'IDEMPOTENCY_KEY_IN_PROGRESS') {
        // No answer, or the server is still at it: kept with its key for «Дахин илгээх».
        setUnsent((list) => [...list, scan]);
        return;
      }
      const { problem } = error;
      if (problem.code === 'UNIT_SUPERSEDED' && scan.code !== undefined && !again) {
        // The barcode moved to the product's new unit: look it up once more.
        units.current.delete(scan.code);
        await send({ ...scan, key: randomUuid() }, true);
        return;
      }
      handlers.current.onFailed(
        problem.code === 'VALIDATION_FAILED' && scan.qty.startsWith('-')
          ? { tone: 'error', text: t('inventory.stocktake.takeBackTooMuch') }
          : { tone: 'problem', problem },
      );
    }
  };

  const push = (scan: PendingScan) => {
    setPending((count) => count + 1);
    chain.current = chain.current
      .then(() => send(scan))
      .finally(() => setPending((count) => count - 1));
  };

  const retry = () => {
    const list = unsent;
    setUnsent([]);
    for (const scan of list) push(scan);
  };

  // Scans not yet on the server would be lost with the page.
  const waiting = pending + unsent.length;
  useEffect(() => {
    if (waiting === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [waiting]);

  return { push, retry, pending, unsent: unsent.length };
}

/**
 * Counting (ADR-0038), made for a phone: scan a shelf label, then the goods on it. Every scan adds
 * one of its unit (or the «Тоо» typed first). The counter sees only what was counted here, never
 * what the system expects; «Тавиур дууссан» records whatever was not counted as not found.
 */
export function StocktakeCounter({ detail }: { detail: StocktakeDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mutations = useStocktakeMutations();
  const action = useAction();
  const binParam = Number.parseInt(params.get('bin') ?? '', 10);
  const activeBin = detail.bins.find((bin) => bin.id === binParam);
  const lines = useStocktakeBinLines(detail.id, activeBin?.id);
  const multiplier = useScanQty();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirm, setConfirm] = useState<'finish' | 'review' | 'cancel' | null>(null);
  const byCode = useMemo(() => new Map(detail.bins.map((bin) => [bin.code, bin])), [detail.bins]);
  const unfinished = detail.bins.filter((bin) => bin.finishedAt === null).length;
  const rows = lines.data?.data ?? [];

  const queue = useScanQueue(
    detail.id,
    (result, scan) => {
      const { added, line } = result;
      const values = {
        name: line.productName,
        qty: signed(added.qty),
        unit: added.unitName,
        base: signed(added.qtyBase),
        total: line.countedQty ?? '0',
        baseUnit: line.baseUnitName,
      };
      const inBase = added.qty === added.qtyBase && added.unitName === line.baseUnitName;
      setFeedback({
        tone: 'ok',
        text: t(inBase ? 'inventory.stocktake.added' : 'inventory.stocktake.addedInUnit', values),
        // A take-back is not taken back again.
        ...(scan.qty.startsWith('-') ? {} : { undo: { ...scan, qty: `-${scan.qty}` } }),
      });
    },
    setFeedback,
  );

  const activate = (bin: StocktakeBin) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('bin', String(bin.id));
        return next;
      },
      { replace: true },
    );
    setFeedback({ tone: 'ok', text: t('inventory.stocktake.binActive', { code: bin.code }) });
  };

  const count = (scan: Omit<PendingScan, 'key' | 'binId' | 'qty'>, qtyText = multiplier.read()) => {
    if (!activeBin) {
      setFeedback({ tone: 'error', text: t('inventory.needBin') });
      return;
    }
    const qty = parseScanQty(qtyText);
    if (qty === null) {
      setFeedback({ tone: 'error', text: t('inventory.stocktake.badQty') });
      return;
    }
    queue.push({ ...scan, key: randomUuid(), binId: activeBin.id, qty });
    multiplier.reset();
  };

  const onScan = (code: string) => {
    const bin = byCode.get(normalizeBinCode(code));
    if (bin) {
      activate(bin);
      return;
    }
    if (!activeBin && looksLikeLabel(code)) {
      setFeedback({
        tone: 'error',
        text: t('inventory.stocktake.binNotInCount', { code: normalizeBinCode(code) }),
      });
      return;
    }
    count({ code });
  };

  const step = (line: StocktakeLine, delta: 1 | -1) =>
    queue.push({
      key: randomUuid(),
      binId: line.binId,
      qty: delta > 0 ? '1' : '-1',
      unit: { id: line.baseUnitId },
    });

  const setCount = (line: StocktakeLine, countedQty: string) =>
    void action.run(() =>
      mutations.setCount.mutateAsync({
        id: detail.id,
        binId: line.binId,
        productId: line.productId,
        countedQty,
        previousQty: line.countedQty,
      }),
    );

  const finishBin = () =>
    void action.run(async () => {
      if (!activeBin) return;
      await mutations.finishBin.mutateAsync({ id: detail.id, binId: activeBin.id });
      setConfirm(null);
      setFeedback({
        tone: 'ok',
        text: t('inventory.stocktake.binFinished', { code: activeBin.code }),
      });
    });
  const review = () =>
    void action.run(async () => {
      await mutations.review.mutateAsync(detail.id);
      setConfirm(null);
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync(detail.id);
      setConfirm(null);
      await navigate('/inventory/stocktakes');
    });
  const ask = (which: 'finish' | 'review' | 'cancel') => {
    action.clear();
    setConfirm(which);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        {/* The note is the card's description, as on every document (ADR-0066). */}
        {detail.note ? (
          <CardHeader>
            <CardDescription>{detail.note}</CardDescription>
          </CardHeader>
        ) : null}
        <CardContent className="flex flex-col gap-3">
          <ScanToolbar
            scanBox={
              <ScanBox
                letters
                label={t('inventory.stocktake.scanLabel')}
                placeholder={t('inventory.stocktake.scanPlaceholder')}
                onScan={onScan}
              />
            }
            qty={
              <div className="flex flex-wrap items-center gap-2 lg:h-9 lg:flex-nowrap">
                <Label htmlFor="stocktake-qty">{t('inventory.stocktake.multiplier')}</Label>
                <ScanQtyField id="stocktake-qty" qty={multiplier} onScan={onScan} />
                <span className="text-xs text-muted-foreground lg:max-w-56">
                  {t('inventory.stocktake.multiplierHint')}
                </span>
              </div>
            }
          />
          <p className="text-lg font-semibold">
            {activeBin
              ? t('inventory.stocktake.activeBin', { code: activeBin.code })
              : t('inventory.stocktake.pickBin')}
          </p>
          <FeedbackLine
            feedback={feedback}
            onUndo={(scan) => {
              queue.push({ ...scan, key: randomUuid() });
              setFeedback(null);
            }}
          />
          {queue.pending > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('inventory.stocktake.sending', { count: queue.pending })}
            </p>
          ) : null}
          {queue.unsent > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-destructive">
                {t('inventory.stocktake.unsent', { count: queue.unsent })}
              </p>
              <Button variant="outline" onClick={queue.retry}>
                {t('inventory.stocktake.retry')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {activeBin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.stocktake.linesTitle', { code: activeBin.code })}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ProblemAlert
              problem={confirm ? null : (action.problem ?? problemFromError(lines.error))}
            />
            {rows.length > 0 ? (
              <ul className="flex flex-col divide-y rounded-md border">
                {rows.map((line) => (
                  <CountRow
                    key={`${line.id}:${line.countedQty ?? ''}`}
                    line={line}
                    onStep={(delta) => step(line, delta)}
                    onSet={(value) => setCount(line, value)}
                    onScan={onScan}
                  />
                ))}
              </ul>
            ) : lines.isPending ? null : (
              <p className="text-sm text-muted-foreground">{t('inventory.stocktake.noLines')}</p>
            )}
            {lines.data?.nextCursor ? (
              <p className="text-xs text-muted-foreground">{t('inventory.stocktake.moreLines')}</p>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {t('inventory.stocktake.searchHint')}
              </span>
              <ProductSearch onPick={(product) => count({ unit: { id: product.baseUnit.id } })} />
            </div>
            {/* A finished shelf still takes scans; finishing it again would change nothing. */}
            <Button
              variant="secondary"
              className="self-start"
              disabled={activeBin.finishedAt !== null || mutations.finishBin.isPending}
              onClick={() => ask('finish')}
            >
              {activeBin.finishedAt
                ? t('inventory.stocktake.finished')
                : t('inventory.stocktake.finishBin')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ShelfGrid bins={detail.bins} activeId={activeBin?.id} onPick={activate} />

      <StickyActions
        summary={
          unfinished > 0 ? t('inventory.stocktake.unfinishedLeft', { count: unfinished }) : null
        }
      >
        <Button variant="ghost" onClick={() => ask('cancel')}>
          {t('inventory.stocktake.cancel')}
        </Button>
        <Button
          disabled={unfinished > 0 || queue.pending > 0 || queue.unsent > 0}
          onClick={() => ask('review')}
        >
          {t('inventory.stocktake.finishCount')}
        </Button>
      </StickyActions>

      <ConfirmDialog
        open={confirm === 'finish'}
        variant="default"
        title={t('inventory.stocktake.finishTitle', { code: activeBin?.code ?? '' })}
        description={t('inventory.stocktake.finishDescription')}
        confirmLabel={t('inventory.stocktake.finishBin')}
        pending={mutations.finishBin.isPending}
        problem={action.problem}
        onConfirm={finishBin}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'review'}
        variant="default"
        title={t('inventory.stocktake.reviewTitle')}
        description={t('inventory.stocktake.reviewDescription')}
        confirmLabel={t('inventory.stocktake.finishCount')}
        pending={mutations.review.isPending}
        problem={action.problem}
        onConfirm={review}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.stocktake.cancelTitle')}
        description={t('inventory.stocktake.cancelDescription')}
        confirmLabel={t('inventory.stocktake.cancel')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function FeedbackLine({
  feedback,
  onUndo,
}: {
  feedback: Feedback;
  onUndo: (scan: PendingScan) => void;
}) {
  const { t } = useTranslation();
  if (!feedback) return null;
  if (feedback.tone === 'problem') return <ProblemAlert problem={feedback.problem} />;
  if (feedback.tone === 'error') {
    return (
      <p role="status" className="text-sm font-medium text-destructive">
        {feedback.text}
      </p>
    );
  }
  const { undo } = feedback;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-sm font-medium">
        {feedback.text}
      </p>
      {undo ? (
        <Button variant="outline" size="sm" onClick={() => onUndo(undo)}>
          <Undo2 />
          {t('inventory.stocktake.undo')}
        </Button>
      ) : null}
    </div>
  );
}

/** A counted line: − and + change it by one base unit; the field sets the total (0 too). */
function CountRow(props: {
  line: StocktakeLine;
  onStep: (delta: 1 | -1) => void;
  onSet: (value: string) => void;
  onScan: (code: string) => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const counted = line.countedQty ?? '0';
  const [draft, setDraft] = useState(counted);
  const guard = useScanGuard(props.onScan, { letters: true });
  const value = parseCount(draft);
  const save = () => {
    if (value === null || new Decimal(value).equals(counted)) return;
    props.onSet(value);
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
        {line.productName}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          aria-label={t('inventory.stocktake.decrease', { name: line.productName })}
          disabled={new Decimal(counted).lt(1)}
          onClick={() => props.onStep(-1)}
        >
          <Minus />
        </Button>
        <Input
          aria-label={t('inventory.stocktake.countFor', { name: line.productName })}
          aria-invalid={value === null}
          inputMode="decimal"
          autoComplete="off"
          className={cn('w-20 text-right font-mono', value === null && 'border-destructive')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            guard(event, draft, setDraft);
            if (event.defaultPrevented || event.key !== 'Enter') return;
            event.preventDefault();
            save();
          }}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label={t('inventory.stocktake.increase', { name: line.productName })}
          onClick={() => props.onStep(1)}
        >
          <Plus />
        </Button>
        <span className="w-10 text-sm text-muted-foreground">{line.baseUnitName}</span>
      </div>
    </li>
  );
}

/** The shelves of the count: finished ones marked; a tap makes one the active shelf. */
function ShelfGrid(props: {
  bins: StocktakeBin[];
  activeId: number | undefined;
  onPick: (bin: StocktakeBin) => void;
}) {
  const { t } = useTranslation();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const finished = props.bins.filter((bin) => bin.finishedAt !== null).length;
  const shown = props.bins.filter((bin) => !onlyOpen || bin.finishedAt === null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('inventory.stocktake.shelves', { finished, total: props.bins.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <FilterToggle
            label={t('inventory.stocktake.onlyUnfinished')}
            checked={onlyOpen}
            onCheckedChange={setOnlyOpen}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {shown.slice(0, SHELVES_SHOWN).map((bin) => (
            <Button
              key={bin.id}
              variant={bin.id === props.activeId ? 'secondary' : 'outline'}
              aria-pressed={bin.id === props.activeId}
              className="h-auto flex-col gap-0 py-2"
              onClick={() => props.onPick(bin)}
            >
              <span className="font-mono">{bin.code}</span>
              <span className="text-xs font-normal">
                {bin.finishedAt
                  ? t('inventory.stocktake.finished')
                  : t('inventory.stocktake.countedLines', { count: bin.countedCount })}
              </span>
            </Button>
          ))}
        </div>
        {shown.length > SHELVES_SHOWN ? (
          <p className="text-xs text-muted-foreground">
            {t('inventory.stocktake.moreShelves', { count: shown.length - SHELVES_SHOWN })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
