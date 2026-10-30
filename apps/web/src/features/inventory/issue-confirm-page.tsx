import { BINS_SOON } from '@/lib/features';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBarcodeLookup } from '@/features/catalog/api';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type IssueDetail, type IssueLine, useBinLookup, useIssue, useIssueMutations } from './api';
import { looksLikeLabel } from './helpers';
import { IssueConfirmations } from './issue-parts';
import { DocStatusBadge } from './shared';
import { useWritableWarehouses } from './writable-warehouses';

/**
 * The keeper's confirmation of a sent goods issue (ADR-0117 #1–#3): the lines of their own
 * warehouses, each ticked by hand or by a barcode scan (a handheld scanner works anywhere on the
 * page; the scan jumps to the line and ticks it); a shelf label scanned after a line names the
 * shelf it leaves from. «Батлах» posts the keeper's part at once; «Буцаах» sends the document back
 * to the accountant with a note.
 */
export function IssueConfirmPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const issue = useIssue(id, !Number.isNaN(id));
  const loadProblem = problemFromError(issue.error);
  if (loadProblem || !issue.data) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('inventory.issues.openConfirm')} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} onRetry={issue.refetch} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return <Confirming detail={issue.data} />;
}

function Confirming({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const writable = useWritableWarehouses();
  const mutations = useIssueMutations();
  const lookup = useBarcodeLookup();
  const lookupBin = useBinLookup();
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lineId: number; at: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [confirmKey, setConfirmKey] = useState(randomUuid);
  const own = detail.warehouses.filter(
    (warehouse) => writable === null || writable.has(warehouse.warehouseId),
  );
  const [warehouseId, setWarehouseId] = useState<number | null>(
    own.length === 1 && detail.warehouses.length > 1 ? (own[0]?.warehouseId ?? null) : null,
  );
  const confirmed = new Set(detail.confirmations.map((row) => row.warehouseId));
  const mine = (line: IssueLine) => writable === null || writable.has(line.warehouseId);
  const lines = detail.lines.filter(
    (line) => warehouseId === null || line.warehouseId === warehouseId,
  );
  const open = detail.lines.filter((line) => mine(line) && !confirmed.has(line.warehouseId));
  const checked = open.filter((line) => line.checkedAt !== null).length;
  const title = t('inventory.issues.confirm.title', {
    number: detail.number ?? t('inventory.draftNo', { id: detail.id }),
  });

  if (detail.status !== 'SENT') {
    return (
      <div className="space-y-4">
        <PageHeader title={title} meta={<DocStatusBadge status={detail.status} />} />
        <p className="text-sm text-muted-foreground">
          {t('inventory.issues.confirm.notSent')}{' '}
          <Link
            className="text-link underline-offset-4 hover:underline"
            to={`/inventory/issues/${detail.id}`}
          >
            {t('inventory.issues.confirm.document')}
          </Link>
        </p>
      </div>
    );
  }

  const tick = (line: IssueLine, value: boolean) =>
    void action.run(() => mutations.checkLine.mutateAsync({ id: line.id, checked: value }));

  const onScan = (code: string) => {
    setMessage(null);
    void action.run(async () => {
      if (looksLikeLabel(code)) {
        // A shelf label names the shelf the focused line leaves from.
        const line = detail.lines.find((row) => row.id === focus?.lineId);
        if (!line) {
          setMessage(t('inventory.issues.confirm.noFocus'));
          return;
        }
        const bin = await lookupBin.mutateAsync({ warehouseId: line.warehouseId, code });
        await mutations.setLineBin.mutateAsync({ id: line.id, binId: bin.id });
        setMessage(
          t('inventory.issues.confirm.binSet', { product: line.productName, code: bin.code }),
        );
        return;
      }
      const resolved = await lookup.mutateAsync(code);
      const ofProduct = open.filter((line) => line.productId === resolved.product.id);
      const line =
        ofProduct.find((row) => row.productUnitId === resolved.unit.id) ?? ofProduct[0] ?? null;
      if (line === null) {
        setMessage(t('inventory.issues.confirm.notFound', { code }));
        return;
      }
      if (warehouseId !== null && line.warehouseId !== warehouseId) setWarehouseId(null);
      setFocus({ lineId: line.id, at: Date.now() });
      if (line.checkedAt === null) {
        await mutations.checkLine.mutateAsync({ id: line.id, checked: true });
      }
      setMessage(
        t('inventory.issues.confirm.scanned', {
          product: line.productName,
          qty: formatQty(line.enteredQty),
          unit: line.unitName,
        }),
      );
    });
  };

  const confirm = () =>
    void action.run(async () => {
      const result = await mutations.confirm.mutateAsync({ id: detail.id, key: confirmKey });
      setConfirming(false);
      setConfirmKey(randomUuid());
      toast.success(
        result.status === 'POSTED'
          ? t('inventory.issues.confirm.posted', { number: result.number ?? '' })
          : t('inventory.issues.confirm.confirmed'),
      );
      await navigate(`/inventory/issues/${detail.id}`);
    });

  const sendBack = () =>
    void action.run(async () => {
      await mutations.returnIssue.mutateAsync({ id: detail.id, note: note.trim() });
      setReturning(false);
      toast.success(t('inventory.issues.confirm.returned'));
      await navigate(`/inventory/issues/${detail.id}`);
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            <span>
              {t(`inventory.issues.recipientKinds.${detail.recipientKind}`)}
              {detail.recipientName ? ` · ${detail.recipientName}` : ''}
            </span>
          </>
        }
        description={t('inventory.issues.confirm.description')}
      />
      <Card role="region" aria-labelledby="confirm-lines-title">
        <CardHeader>
          <CardTitle id="confirm-lines-title">{t('inventory.issues.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <ScanBox letters onScan={onScan} disabled={confirming || returning} autoFocus />
            </div>
            {detail.warehouses.length > 1 ? (
              <FormField
                label={t('inventory.issues.confirm.warehouseFilter')}
                htmlFor="confirm-warehouse"
              >
                <NativeSelect
                  id="confirm-warehouse"
                  value={warehouseId ?? ''}
                  onChange={(event) =>
                    setWarehouseId(
                      event.target.value ? Number.parseInt(event.target.value, 10) : null,
                    )
                  }
                >
                  <option value="">{t('inventory.issues.confirm.allWarehouses')}</option>
                  {detail.warehouses.map((warehouse) => (
                    <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                      {warehouse.warehouseName}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
          </div>
          <p aria-live="polite" className="min-h-5 text-sm">
            {message}
          </p>
          <ProblemAlert problem={confirming || returning ? null : action.problem} />
          <IssueConfirmations detail={detail} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">{t('inventory.issues.confirm.checkedCol')}</span>
                </TableHead>
                <TableHead>{t('inventory.sku')}</TableHead>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                {BINS_SOON ? null : <TableHead>{t('inventory.bin')}</TableHead>}
                <TableHead>{t('inventory.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <ConfirmRow
                  key={line.id}
                  line={line}
                  frozen={confirmed.has(line.warehouseId)}
                  foreign={!mine(line)}
                  focusAt={focus?.lineId === line.id ? focus.at : null}
                  onTick={(value) => tick(line, value)}
                  onFocus={() => setFocus({ lineId: line.id, at: Date.now() })}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <StickyActions
        summary={t('inventory.issues.confirm.progress', { checked, total: open.length })}
      >
        <Button variant="outline" asChild>
          <Link to={`/inventory/issues/${detail.id}`}>
            {t('inventory.issues.confirm.document')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          disabled={open.length === 0}
          onClick={() => {
            action.clear();
            setReturning(true);
          }}
        >
          <Undo2 />
          {t('inventory.issues.confirm.return')}
        </Button>
        <Button
          disabled={open.length === 0 || checked < open.length}
          onClick={() => {
            action.clear();
            setConfirming(true);
          }}
        >
          {t('inventory.issues.confirm.confirm')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        variant="default"
        title={t('inventory.issues.confirm.confirmTitle')}
        description={t('inventory.issues.confirm.confirmDescription')}
        confirmLabel={t('inventory.issues.confirm.confirm')}
        pending={mutations.confirm.isPending}
        problem={action.problem}
        onConfirm={confirm}
        onClose={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={returning}
        title={t('inventory.issues.confirm.returnTitle')}
        confirmLabel={t('inventory.issues.confirm.return')}
        pending={mutations.returnIssue.isPending}
        disabled={note.trim() === ''}
        problem={action.problem}
        onConfirm={sendBack}
        onClose={() => setReturning(false)}
      >
        <FormField label={t('inventory.issues.confirm.returnNote')} htmlFor="confirm-return-note">
          <Textarea
            id="confirm-return-note"
            maxLength={500}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

/** One line: its tick, product, warehouse, unit, quantity, shelf and state. */
function ConfirmRow(props: {
  line: IssueLine;
  frozen: boolean;
  foreign: boolean;
  focusAt: number | null;
  onTick: (checked: boolean) => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const box = useRef<HTMLButtonElement>(null);
  const disabled = props.frozen || props.foreign;

  // A scan of this line's product puts the cursor on its tick.
  useEffect(() => {
    if (props.focusAt === null) return;
    box.current?.focus();
  }, [props.focusAt]);

  return (
    <TableRow
      data-state={props.focusAt === null ? undefined : 'selected'}
      className={disabled ? 'text-muted-foreground' : undefined}
      onClick={props.onFocus}
    >
      <TableCell>
        <Checkbox
          ref={box}
          aria-label={t('inventory.issues.confirm.check', {
            product: line.productName,
            unit: line.unitName,
          })}
          disabled={disabled}
          checked={line.checkedAt !== null}
          onCheckedChange={(value) => props.onTick(value === true)}
        />
      </TableCell>
      <TableCell className="font-mono text-[0.8125rem]">{line.productSku}</TableCell>
      <TableCell className="min-w-40 whitespace-normal">{line.productName}</TableCell>
      <TableCell>{line.warehouseName}</TableCell>
      <TableCell>{line.unitName}</TableCell>
      <TableCell className="text-right font-mono">{formatQty(line.enteredQty)}</TableCell>
      {BINS_SOON ? null : (
        <TableCell className="font-mono">{line.binCode ?? t('common.none')}</TableCell>
      )}
      <TableCell>
        {props.frozen ? (
          <Badge variant="success">{t('inventory.issues.confirm.frozen')}</Badge>
        ) : line.checkedAt !== null ? (
          <Badge variant="success">{t('inventory.issues.confirm.checkedCol')}</Badge>
        ) : (
          <Badge variant="secondary">{t('inventory.receipt.receive.unchecked')}</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
