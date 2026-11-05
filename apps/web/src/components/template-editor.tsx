import {
  RECEIPT_ALIGNS,
  RECEIPT_LOGO_WIDTHS,
  RECEIPT_RULES,
  RECEIPT_SIZES,
  RECEIPT_TEMPLATE_LIMITS,
  type ReceiptAlign,
  type ReceiptBlockShow,
  type ReceiptDividerBlock,
  type ReceiptLogoBlock,
  type ReceiptLogoWidth,
  type ReceiptQrBlock,
  type ReceiptSize,
  type ReceiptSpaceBlock,
  type ReceiptTextBlock,
} from '@tugeel/shared/pos';
import { cn } from 'cn';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  History,
  ImageUp,
  Lock,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatUbDateTime } from '@/lib/dayjs';
import { readImageFile, receiptLogo } from '@/lib/print-logo';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useTemplateHistory, useUndoKeys } from '@/lib/template-history';

const PRINT_ROOT_ID = 'bto-template-print';

/** What every block of a template has: a type, and an optional block may be hidden. */
export interface EditorBlock {
  type: string;
  hidden?: boolean;
}
export interface EditorLayout<B extends EditorBlock> {
  blocks: B[];
}

/** A template as the editor shows it, whatever it lays out (ADR-0141, ADR-0143). */
export interface EditorTemplate<L> {
  id: number;
  name: string;
  /** The kind of document, as a badge. */
  kindLabel: string;
  isDefault: boolean;
  version: number;
  layout: L;
  draft: L | null;
  versions: { version: number; publishedAt: string; publishedBy: string | null }[];
}

/** The blocks a kind of template knows. */
export interface EditorCatalog<B extends EditorBlock> {
  /** What «Блок нэмэх» offers, in its order. */
  addable: readonly B['type'][];
  /** Always there: moved and set, never removed or hidden. */
  required: readonly B['type'][];
  /** At most once (the required ones included). */
  single: readonly B['type'][];
  maxBlocks: number;
  newBlock: (type: B['type']) => B;
  label: (type: B['type']) => string;
  /** A short line beside the block's name; null for none. */
  summary: (block: B) => string | null;
  /** When it prints, if not always; null for always. */
  condition: (block: B) => string | null;
}

export interface EditorActions<L> {
  save: (name: string, layout: L) => Promise<unknown>;
  publish: () => Promise<unknown>;
  discard: () => Promise<unknown>;
  restore: (version: number) => Promise<unknown>;
  makeDefault: () => Promise<unknown>;
  savePending: boolean;
  busy: boolean;
}

interface Work<L> {
  name: string;
  layout: L;
}

const same = <L,>(a: Work<L>, b: Work<L>) =>
  a.name.trim() === b.name.trim() && JSON.stringify(a.layout) === JSON.stringify(b.layout);

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * A template's editor page (ADR-0141, ADR-0142, ADR-0143), the same for the POS receipts and the
 * wholesale documents: the name and the kind's own settings, the blocks in print order — dragged
 * or moved with the arrows, copied, hidden, each with its options, the required ones locked in —,
 * the document drawn live, a test print on this PC's printer, «Буцаах» / «Дахих», back to the
 * built-in layout. «Хадгалах» keeps a draft; «Нийтлэх» puts it in force as the next version; an
 * earlier version can be brought back as the draft.
 */
export function TemplateEditor<B extends EditorBlock, L extends EditorLayout<B>>(props: {
  template: EditorTemplate<L>;
  canManage: boolean;
  catalog: EditorCatalog<B>;
  check: (layout: L) => { path: string; detail: string } | null;
  builtIn: () => L;
  actions: EditorActions<L>;
  maxName: number;
  /** The kind's own settings beside the name (the paper, the text size). */
  general: (layout: L, set: (patch: Partial<L>) => void, disabled: boolean) => ReactNode;
  /** A block's options. */
  options: (block: B, onChange: (patch: Partial<B>) => void, disabled: boolean) => ReactNode;
  /** The document drawn with this layout, on the screen. */
  preview: (layout: L) => ReactNode;
  /** The made-up document's switches above the preview. */
  previewControls?: ReactNode;
  /** The test print: what to print and how wide. */
  print: (layout: L) => { content: ReactNode; width: string; pageRule: string };
}) {
  const { t } = useTranslation();
  const { template, canManage, catalog, actions } = props;
  const action = useAction();
  const saved: Work<L> = useMemo(
    () => ({ name: template.name, layout: template.draft ?? template.layout }),
    [template],
  );
  const history = useTemplateHistory(saved);
  const { work, change } = history;
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [printing, setPrinting] = useState(0);
  useUndoKeys(canManage, history.undo, history.redo);
  const dirty = !same(work, saved);
  const blocks = work.layout.blocks;
  const problem = props.check(work.layout);
  const unpublished = dirty || template.draft !== null;
  const full = blocks.length >= catalog.maxBlocks;

  const setLayout = (patch: Partial<L>) =>
    change((current) => ({ ...current, layout: { ...current.layout, ...patch } }));
  const setBlocks = (next: B[]) => setLayout({ blocks: next } as Partial<L>);
  const updateBlock = (index: number, patch: Partial<B>) =>
    setBlocks(blocks.map((block, at) => (at === index ? { ...block, ...patch } : block)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    setBlocks(moved(blocks, from, to));
    setSelected(to);
  };
  const insert = (block: B, at: number) => {
    const next = [...blocks];
    next.splice(at, 0, block);
    setBlocks(next);
    setSelected(at);
  };
  const addable = catalog.addable.filter(
    (type) => !catalog.single.includes(type) || !blocks.some((block) => block.type === type),
  );

  const run = (job: () => Promise<unknown>, done: string) =>
    action.run(async () => {
      await job();
      toast.success(done);
    });
  const save = () => run(() => actions.save(work.name, work.layout), t('templateEditor.saved'));
  const publish = () =>
    run(async () => {
      if (dirty) await actions.save(work.name, work.layout);
      await actions.publish();
      setPublishing(false);
    }, t('templateEditor.published'));
  const discard = () =>
    run(async () => {
      if (template.draft) await actions.discard();
      else change(() => saved);
    }, t('templateEditor.discarded'));

  useEffect(() => {
    if (printing === 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.print();
      setPrinting(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [printing]);
  const printable = printing > 0 ? props.print(work.layout) : null;

  return (
    <div>
      <PageHeader
        title={template.name}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{template.kindLabel}</Badge>
            {template.isDefault ? (
              <Badge variant="success">{t('templateEditor.default')}</Badge>
            ) : null}
            <Badge variant="outline">
              {t('templateEditor.version', { version: template.version })}
            </Badge>
            {unpublished ? (
              <Badge variant="warning">
                {dirty ? t('templateEditor.unsaved') : t('templateEditor.draft')}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          canManage ? (
            <>
              {template.isDefault ? null : (
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(
                      actions.makeDefault,
                      t('templateEditor.defaultSet', { name: template.name }),
                    )
                  }
                >
                  <Star />
                  {t('templateEditor.makeDefault')}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={!unpublished || actions.busy}
                onClick={() => void discard()}
              >
                <RotateCcw />
                {t('templateEditor.discard')}
              </Button>
              <Button
                variant="outline"
                disabled={!dirty || problem !== null}
                pending={actions.savePending}
                onClick={() => void save()}
              >
                <Save />
                {t('common.save')}
              </Button>
              <Button
                disabled={!unpublished || problem !== null || actions.busy}
                onClick={() => setPublishing(true)}
              >
                <Send />
                {t('templateEditor.publish')}
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        <LeaveGuard
          when={dirty}
          title={t('templateEditor.leaveTitle')}
          description={t('templateEditor.leaveDescription')}
          leaveLabel={t('templateEditor.leave')}
        />
        <ProblemAlert problem={action.problem} />
        {problem ? (
          <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            {t('templateEditor.invalid', { path: problem.path, detail: problem.detail })}
          </p>
        ) : null}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('templateEditor.sections.general')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <FormField label={t('templateEditor.fields.name')} htmlFor="tpl-name">
                  <Input
                    id="tpl-name"
                    disabled={!canManage}
                    maxLength={props.maxName}
                    value={work.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      change((current) => ({ ...current, name }));
                    }}
                  />
                </FormField>
                {props.general(work.layout, setLayout, !canManage)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle>{t('templateEditor.sections.blocks')}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('templateEditor.blocksHint')}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('templateEditor.undo')}
                      title={t('templateEditor.undo')}
                      disabled={!history.canUndo}
                      onClick={history.undo}
                    >
                      <Undo2 />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('templateEditor.redo')}
                      title={t('templateEditor.redo')}
                      disabled={!history.canRedo}
                      onClick={history.redo}
                    >
                      <Redo2 />
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setResetting(true)}>
                      {t('templateEditor.reset')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={full}>
                          <Plus />
                          {t('templateEditor.addBlock')}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {addable.map((type) => (
                          <DropdownMenuItem
                            key={type}
                            onSelect={() =>
                              insert(
                                catalog.newBlock(type),
                                selected === null ? blocks.length : selected + 1,
                              )
                            }
                          >
                            {catalog.label(type)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <ol aria-label={t('templateEditor.sections.blocks')} className="space-y-1.5">
                  {blocks.map((block, index) => (
                    <BlockRow
                      key={index}
                      name={catalog.label(block.type)}
                      summary={catalog.summary(block)}
                      condition={catalog.condition(block)}
                      hidden={block.hidden === true}
                      required={catalog.required.includes(block.type)}
                      index={index}
                      count={blocks.length}
                      selected={selected === index}
                      dragging={dragging === index}
                      canManage={canManage}
                      canCopy={!full && !catalog.single.includes(block.type)}
                      onSelect={() => setSelected(selected === index ? null : index)}
                      onMove={(to) => move(index, to)}
                      onCopy={() => insert(structuredClone(block), index + 1)}
                      onHide={() => updateBlock(index, { hidden: !block.hidden } as Partial<B>)}
                      onRemove={() => {
                        setBlocks(blocks.filter((_, at) => at !== index));
                        setSelected(null);
                      }}
                      onDragStart={() => setDragging(index)}
                      onDragEnd={() => setDragging(null)}
                      onDrop={() => {
                        if (dragging !== null) move(dragging, index);
                        setDragging(null);
                      }}
                    >
                      {selected === index
                        ? props.options(block, (patch) => updateBlock(index, patch), !canManage)
                        : null}
                    </BlockRow>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <Versions
              template={template}
              canManage={canManage}
              onRestore={(version) =>
                void run(() => actions.restore(version), t('templateEditor.restored', { version }))
              }
            />
          </div>
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>{t('templateEditor.sections.preview')}</CardTitle>
                {props.previewControls ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{props.previewControls}</div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={t('templateEditor.testPrintHint')}
                onClick={() => setPrinting((count) => count + 1)}
              >
                <Printer />
                {t('templateEditor.testPrint')}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="max-h-[calc(100svh-14rem)] overflow-auto rounded-lg bg-fill p-4 [scrollbar-width:thin]">
                {props.preview(work.layout)}
              </div>
            </CardContent>
          </Card>
        </div>
        {printable
          ? createPortal(
              <div id={PRINT_ROOT_ID} aria-hidden>
                <style>{`${printable.pageRule}
@media screen { #${PRINT_ROOT_ID} { display: none; } }
@media print {
  body > :not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block; width: ${printable.width}; margin: 0 auto; }
}`}</style>
                {printable.content}
              </div>,
              document.body,
            )
          : null}
        <ConfirmDialog
          open={publishing}
          variant="default"
          title={t('templateEditor.publishTitle', { version: template.version + 1 })}
          description={t('templateEditor.publishDescription')}
          confirmLabel={t('templateEditor.publish')}
          pending={actions.busy}
          problem={action.problem}
          onConfirm={() => void publish()}
          onClose={() => setPublishing(false)}
        />
        <ConfirmDialog
          open={resetting}
          title={t('templateEditor.resetTitle')}
          description={t('templateEditor.resetDescription')}
          confirmLabel={t('templateEditor.reset')}
          onConfirm={() => {
            change((current) => ({ ...current, layout: props.builtIn() }));
            setSelected(null);
            setResetting(false);
          }}
          onClose={() => setResetting(false)}
        />
      </div>
    </div>
  );
}

function BlockRow(props: {
  name: string;
  summary: string | null;
  condition: string | null;
  hidden: boolean;
  required: boolean;
  index: number;
  count: number;
  selected: boolean;
  dragging: boolean;
  canManage: boolean;
  canCopy: boolean;
  onSelect: () => void;
  onMove: (to: number) => void;
  onCopy: () => void;
  onHide: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const { name, hidden, required } = props;
  const hideLabel = hidden ? t('templateEditor.show') : t('templateEditor.hide');
  return (
    <li
      draggable={props.canManage}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = 'move';
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        props.onDrop();
      }}
      className={cn(
        'rounded-lg border bg-background transition-colors',
        props.selected ? 'border-ring' : 'border-border',
        over ? 'bg-accent' : null,
        props.dragging ? 'opacity-50' : null,
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        {props.canManage ? (
          <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-muted-foreground" />
        ) : null}
        <button
          type="button"
          aria-expanded={props.selected}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
            hidden ? 'opacity-50' : null,
          )}
          onClick={props.onSelect}
        >
          <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {props.index + 1}
          </span>
          <span className="shrink-0 text-[0.9375rem] font-medium">{name}</span>
          {props.summary ? (
            <span className="min-w-0 truncate text-sm text-muted-foreground">{props.summary}</span>
          ) : null}
          {props.condition ? (
            <Badge variant="outline" className="ml-auto shrink-0">
              {props.condition}
            </Badge>
          ) : null}
          {required ? (
            <Lock
              aria-label={t('templateEditor.locked')}
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground',
                props.condition ? null : 'ml-auto',
              )}
            />
          ) : null}
        </button>
        {props.canManage ? (
          <span className="flex shrink-0 items-center">
            {required ? null : (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${hideLabel}: ${name}`}
                title={hideLabel}
                onClick={props.onHide}
              >
                {hidden ? <EyeOff /> : <Eye />}
              </Button>
            )}
            {props.canCopy ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${t('templateEditor.copy')}: ${name}`}
                title={t('templateEditor.copy')}
                onClick={props.onCopy}
              >
                <Copy />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`${t('templateEditor.moveUp')}: ${name}`}
              disabled={props.index === 0}
              onClick={() => props.onMove(props.index - 1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`${t('templateEditor.moveDown')}: ${name}`}
              disabled={props.index === props.count - 1}
              onClick={() => props.onMove(props.index + 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="hover:bg-danger-soft hover:text-destructive"
              aria-label={`${t('common.delete')}: ${name}`}
              disabled={required}
              onClick={props.onRemove}
            >
              <Trash2 />
            </Button>
          </span>
        ) : null}
      </div>
      {props.children ? (
        <div className="border-t border-border px-3 py-3">{props.children}</div>
      ) : null}
    </li>
  );
}

function Versions<L>(props: {
  template: EditorTemplate<L>;
  canManage: boolean;
  onRestore: (version: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden className="size-4 text-muted-foreground" />
          {t('templateEditor.sections.versions')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {props.template.versions.map((entry) => (
            <li key={entry.version} className="flex items-center gap-3 py-2">
              <span className="w-12 shrink-0 font-mono text-sm font-semibold">
                {t('templateEditor.version', { version: entry.version })}
              </span>
              <span className="font-mono text-sm">
                {formatUbDateTime(Date.parse(entry.publishedAt))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {entry.publishedBy ?? t('templateEditor.system')}
              </span>
              {entry.version === props.template.version ? (
                <Badge variant="success">{t('templateEditor.inForce')}</Badge>
              ) : props.canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => props.onRestore(entry.version)}
                >
                  <RotateCcw />
                  {t('templateEditor.restore')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** A labelled switch on one row. */
export function SwitchRow(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {props.label}
      </Label>
      <Switch
        id={id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </div>
  );
}

/** A labelled checkbox (the preview's switches). */
export function CheckToggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={props.checked}
        onCheckedChange={(value) => props.onChange(value === true)}
      />
      <Label htmlFor={id} className="font-normal">
        {props.label}
      </Label>
    </span>
  );
}

/** An alignment or a size picker. */
export function ChoiceField<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly T[];
  name: (value: T) => string;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <FormField label={props.label} htmlFor={id}>
      <NativeSelect
        id={id}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => {
          const found = props.options.find((option) => String(option) === event.target.value);
          if (found !== undefined) props.onChange(found);
        }}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.name(option)}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

type FreeBlock =
  | Omit<ReceiptTextBlock, 'when'>
  | Omit<ReceiptLogoBlock, 'when'>
  | Omit<ReceiptQrBlock, 'when'>
  | Omit<ReceiptDividerBlock, 'when'>
  | Omit<ReceiptSpaceBlock, 'when'>;

/**
 * The options of a free block — a text with the document's values, a logo, a QR code, a rule, a
 * space — and when it prints: the conditions the kind knows (`whens`), and the dates.
 */
export function FreeBlockOptions(props: {
  block: FreeBlock & { when?: string };
  disabled: boolean;
  /** The values a text may print, `{{name}}`, with their names. */
  variables: readonly { key: string; name: string }[];
  /** The conditions with their names; none: only the dates. */
  whens?: readonly { key: string; name: string }[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const { block, disabled, onChange } = props;
  const id = useId();
  const align = (value: ReceiptAlign) => (
    <ChoiceField
      label={t('templateEditor.fields.align')}
      value={value}
      options={RECEIPT_ALIGNS}
      name={(option) => t(`templateEditor.aligns.${option}`)}
      disabled={disabled}
      onChange={(next) => onChange({ align: next })}
    />
  );
  const size = (value: ReceiptSize) => (
    <ChoiceField
      label={t('templateEditor.fields.textSize')}
      value={value}
      options={RECEIPT_SIZES}
      name={(option) => t(`templateEditor.sizes.${option}`)}
      disabled={disabled}
      onChange={(next) => onChange({ size: next })}
    />
  );
  const show = (
    <ShowOptions
      show={block as ReceiptBlockShow & { when?: string }}
      whens={props.whens}
      disabled={disabled}
      onChange={onChange}
    />
  );
  switch (block.type) {
    case 'TEXT':
      return (
        <div className="flex flex-col gap-3">
          <TextField
            id={`${id}-text`}
            text={block.text}
            variables={props.variables}
            disabled={disabled}
            onChange={(text) => onChange({ text })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {align(block.align)}
            {size(block.size)}
          </div>
          <SwitchRow
            label={t('templateEditor.options.bold')}
            checked={block.bold}
            disabled={disabled}
            onChange={(bold) => onChange({ bold })}
          />
          <SwitchRow
            label={t('templateEditor.options.inverse')}
            checked={block.inverse === true}
            disabled={disabled}
            onChange={(inverse) => onChange({ inverse })}
          />
          {show}
        </div>
      );
    case 'LOGO':
      return (
        <div className="flex flex-col gap-3">
          <LogoUpload disabled={disabled} onImage={(image) => onChange({ image })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceField<ReceiptLogoWidth>
              label={t('templateEditor.fields.width')}
              value={block.width}
              options={RECEIPT_LOGO_WIDTHS}
              name={(option) => `${option}%`}
              disabled={disabled}
              onChange={(width) => onChange({ width })}
            />
            {align(block.align)}
          </div>
          {show}
        </div>
      );
    case 'QR':
      return (
        <div className="flex flex-col gap-3">
          <FormField
            label={t('templateEditor.fields.qrData')}
            htmlFor={`${id}-qr`}
            hint={t('templateEditor.qrHint')}
            error={block.data.trim() === '' ? 'validation.required' : undefined}
          >
            <Input
              id={`${id}-qr`}
              autoFocus
              disabled={disabled}
              maxLength={RECEIPT_TEMPLATE_LIMITS.maxQrData}
              value={block.data}
              onChange={(event) => onChange({ data: event.target.value })}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FormField label={t('templateEditor.fields.caption')} htmlFor={`${id}-caption`}>
              <Input
                id={`${id}-caption`}
                disabled={disabled}
                maxLength={RECEIPT_TEMPLATE_LIMITS.maxCaption}
                value={block.caption ?? ''}
                onChange={(event) => onChange({ caption: event.target.value || null })}
              />
            </FormField>
            {size(block.size)}
          </div>
          {show}
        </div>
      );
    case 'DIVIDER':
      return (
        <div className="flex flex-col gap-3">
          <ChoiceField
            label={t('templateEditor.fields.rule')}
            value={block.rule}
            options={RECEIPT_RULES}
            name={(option) => t(`templateEditor.rules.${option}`)}
            disabled={disabled}
            onChange={(rule) => onChange({ rule })}
          />
          {show}
        </div>
      );
    case 'SPACE':
      return (
        <div className="flex flex-col gap-3">
          {size(block.size)}
          {show}
        </div>
      );
  }
}

/** A text with the document's values: a tap puts `{{name}}` where the cursor is. */
function TextField(props: {
  id: string;
  text: string;
  variables: readonly { key: string; name: string }[];
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const put = (name: string) => {
    const token = `{{${name}}}`;
    const element = area.current;
    const start = element?.selectionStart ?? props.text.length;
    const end = element?.selectionEnd ?? props.text.length;
    props.onChange(props.text.slice(0, start) + token + props.text.slice(end));
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <FormField
      label={t('templateEditor.fields.text')}
      htmlFor={props.id}
      error={props.text.trim() === '' ? 'validation.required' : undefined}
    >
      <Textarea
        ref={area}
        id={props.id}
        rows={3}
        autoFocus
        disabled={props.disabled}
        maxLength={RECEIPT_TEMPLATE_LIMITS.maxText}
        value={props.text}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.variables.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">{t('templateEditor.variables')}</span>
          {props.variables.map((variable) => (
            <Button
              key={variable.key}
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              disabled={props.disabled}
              title={`{{${variable.key}}}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => put(variable.key)}
            >
              {variable.name}
            </Button>
          ))}
        </div>
      ) : null}
    </FormField>
  );
}

/** «Хэвлэх нөхцөл»: the kind's conditions, if it has any, and the dates. */
function ShowOptions(props: {
  show: ReceiptBlockShow & { when?: string };
  whens: readonly { key: string; name: string }[] | undefined;
  disabled: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset
      className={cn(
        'grid gap-3 rounded-lg border border-border/80 p-3',
        props.whens ? 'sm:grid-cols-[minmax(0,1.3fr)_auto_auto]' : 'sm:grid-cols-2',
      )}
    >
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {t('templateEditor.sections.when')}
      </legend>
      {props.whens ? (
        <FormField label={t('templateEditor.fields.when')} htmlFor={`${id}-when`}>
          <NativeSelect
            id={`${id}-when`}
            disabled={props.disabled}
            value={props.show.when ?? 'ALWAYS'}
            onChange={(event) => props.onChange({ when: event.target.value })}
          >
            {props.whens.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}
      <FormField label={t('templateEditor.fields.from')} htmlFor={`${id}-from`}>
        <DateInput
          id={`${id}-from`}
          disabled={props.disabled}
          value={props.show.from ?? ''}
          max={props.show.to ?? undefined}
          onChange={(from) => props.onChange({ from: from || null })}
        />
      </FormField>
      <FormField label={t('templateEditor.fields.to')} htmlFor={`${id}-to`}>
        <DateInput
          id={`${id}-to`}
          disabled={props.disabled}
          value={props.show.to ?? ''}
          min={props.show.from ?? undefined}
          onChange={(to) => props.onChange({ to: to || null })}
        />
      </FormField>
    </fieldset>
  );
}

/** A picture chosen on this PC, made black and white for printing. */
function LogoUpload(props: { disabled: boolean; onImage: (image: string) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [dither, setDither] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async (from: string, shaded: boolean) => {
    setError(null);
    try {
      const image = await receiptLogo(from, shaded);
      if (image) props.onImage(image);
      else setError(t('templateEditor.logoTooBig'));
    } catch {
      setError(t('templateEditor.logoUnreadable'));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={props.disabled}
          onClick={() => input.current?.click()}
        >
          <ImageUp />
          {t('templateEditor.chooseLogo')}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void readImageFile(file).then((read) => {
              setSource(read);
              return make(read, dither);
            });
          }}
        />
        <CheckToggle
          label={t('templateEditor.options.dither')}
          checked={dither}
          onChange={(checked) => {
            setDither(checked);
            if (source) void make(source, checked);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('templateEditor.logoHint')}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
