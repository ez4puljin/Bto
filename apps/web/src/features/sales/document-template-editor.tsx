import { RECEIPT_ALIGNS, RECEIPT_SIZES } from '@tugeel/shared/pos';
import {
  checkDocumentLayout,
  defaultDocumentLayout,
  DOCUMENT_FREE_BLOCKS,
  DOCUMENT_INFO_FIELDS,
  DOCUMENT_REQUIRED_COLUMNS,
  DOCUMENT_SINGLE_BLOCKS,
  DOCUMENT_TEMPLATE_LIMITS,
  type DocumentBlock,
  type DocumentBlockType,
  type DocumentLayout,
  documentRequiredBlocks,
  newDocumentBlock,
} from '@tugeel/shared/sales';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { SegmentedControl } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import {
  CheckToggle,
  ChoiceField,
  type EditorCatalog,
  FreeBlockOptions,
  SwitchRow,
  TemplateEditor,
} from '@/components/template-editor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useCompany, useCompanyName } from '@/features/company/api';
import { useWarehouseName } from '@/features/inventory/helpers';
import { PAGE_RULES, type PrintFormat } from '@/lib/print-format';
import { problemFromError } from '@/lib/problem';
import { datesSummary } from '@/lib/template-history';
import { sampleOrder } from './document-sample';
import {
  type DocumentTemplateDetail,
  useDocumentTemplate,
  useDocumentTemplateMutations,
} from './document-templates-api';
import { DocumentView } from './document-view';

const ADDABLE: readonly DocumentBlockType[] = [
  'TEXT',
  'LOGO',
  'QR',
  'SIGNATURES',
  'DIVIDER',
  'SPACE',
];
/** The values a document's text may print (the receipt's names, ADR-0142). */
const VARIABLES = ['number', 'date', 'time', 'customer', 'total', 'cashier', 'store'] as const;
const PAPERS: readonly PrintFormat[] = ['A4', 'MM80'];

/**
 * A wholesale document's template editor (ADR-0143) on the shared template editor: the text size,
 * the document's blocks and their options — the heading's lines, the order's facts, the lines'
 * columns switched and ordered, the totals, the signatures, the free blocks —, the document drawn
 * live on A4 or the 80 mm roll with a made-up order.
 */
export function DocumentTemplateEditorPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const template = useDocumentTemplate(id);
  if (template.error) {
    return (
      <div>
        <PageHeader title={t('sales.documentTemplates.title')} />
        <ProblemAlert problem={problemFromError(template.error)} />
      </div>
    );
  }
  if (!template.data) return <PageHeader title={t('sales.documentTemplates.title')} />;
  return <Editor key={template.data.id} template={template.data} />;
}

function Editor({ template }: { template: DocumentTemplateDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('sales.boards.manage');
  const mutations = useDocumentTemplateMutations();
  const company = useCompany();
  const companyName = useCompanyName();
  const warehouseName = useWarehouseName();
  const [paper, setPaper] = useState<PrintFormat>('A4');
  const [withNote, setWithNote] = useState(true);
  const kind = template.kind;
  const required = documentRequiredBlocks(kind);
  const catalog: EditorCatalog<DocumentBlock> = {
    addable: ADDABLE,
    required,
    single: DOCUMENT_SINGLE_BLOCKS,
    maxBlocks: DOCUMENT_TEMPLATE_LIMITS.maxBlocks,
    newBlock: (type) => newDocumentBlock(type, kind),
    label: (type) => t(`sales.documentTemplates.blocks.${type}`),
    summary: (block) => {
      switch (block.type) {
        case 'TEXT':
          return block.text.split('\n')[0] ?? null;
        case 'HEADING':
          return block.title;
        case 'QR':
          return block.caption ?? block.data;
        case 'LOGO':
          return `${block.width}%`;
        case 'SIGNATURES':
          return block.labels.join(', ');
        case 'LINES':
          return block.columns
            .filter((column) => column.on)
            .map((column) => t(`sales.documentTemplates.columns.${column.key}`))
            .join(', ');
        case 'DIVIDER':
          return t(`templateEditor.rules.${block.rule}`);
        case 'SPACE':
          return t(`templateEditor.sizes.${block.size}`);
        default:
          return null;
      }
    },
    condition: (block) =>
      DOCUMENT_FREE_BLOCKS.includes(block.type)
        ? datesSummary(block as { from?: string | null; to?: string | null })
        : null,
  };
  const order = sampleOrder(withNote);
  const draw = (layout: DocumentLayout, narrow: boolean) => (
    <DocumentView
      kind={kind}
      order={order}
      layout={layout}
      narrow={narrow}
      company={{
        name: companyName,
        tin: company.data?.tin ?? null,
        registerNo: company.data?.registerNo ?? null,
      }}
      printedAt={Date.now()}
      warehouseName={warehouseName}
    />
  );
  const check = (layout: DocumentLayout) => {
    const result = checkDocumentLayout(layout, kind);
    return result.ok ? null : result;
  };

  return (
    <TemplateEditor<DocumentBlock, DocumentLayout>
      template={{ ...template, kindLabel: t(`sales.printKinds.${kind}`) }}
      canManage={canManage}
      catalog={catalog}
      check={check}
      builtIn={() => defaultDocumentLayout(kind)}
      maxName={DOCUMENT_TEMPLATE_LIMITS.maxName}
      actions={{
        save: (name, layout) => mutations.saveDraft.mutateAsync({ id: template.id, name, layout }),
        publish: () => mutations.publish.mutateAsync(template.id),
        discard: () => mutations.discard.mutateAsync(template.id),
        restore: (version) => mutations.restore.mutateAsync({ id: template.id, version }),
        makeDefault: () => mutations.makeDefault.mutateAsync(template.id),
        savePending: mutations.saveDraft.isPending,
        busy:
          mutations.saveDraft.isPending ||
          mutations.publish.isPending ||
          mutations.discard.isPending,
      }}
      general={(layout, set, disabled) => (
        <ChoiceField
          label={t('templateEditor.fields.size')}
          value={layout.size}
          options={RECEIPT_SIZES}
          name={(value) => t(`templateEditor.sizes.${value}`)}
          disabled={disabled}
          onChange={(size) => set({ size })}
        />
      )}
      options={(block, onChange, disabled) => (
        <BlockOptions
          block={block}
          kind={kind}
          disabled={disabled}
          onChange={(patch) => onChange(patch)}
        />
      )}
      previewControls={
        <>
          <SegmentedControl
            options={PAPERS}
            value={paper}
            label={(value) => t(`sales.print.formats.${value}`)}
            onChange={setPaper}
            name={t('sales.print.paper')}
          />
          <CheckToggle
            label={t('sales.documentTemplates.sampleNote')}
            checked={withNote}
            onChange={setWithNote}
          />
        </>
      }
      preview={(layout) =>
        paper === 'MM80' ? (
          <div className="mx-auto w-[80mm] bg-background px-[4mm] py-[3mm] text-xs leading-snug shadow-control [zoom:1.15]">
            {draw(layout, true)}
          </div>
        ) : (
          <div className="mx-auto w-[190mm] bg-background p-6 text-sm shadow-control [zoom:0.5]">
            {draw(layout, false)}
          </div>
        )
      }
      print={(layout) => ({
        content: (
          <div className={paper === 'MM80' ? 'text-xs leading-snug' : 'text-sm'}>
            {draw(layout, paper === 'MM80')}
          </div>
        ),
        width: paper === 'MM80' ? '72mm' : '100%',
        pageRule: PAGE_RULES[paper],
      })}
    />
  );
}

function BlockOptions(props: {
  block: DocumentBlock;
  kind: DocumentTemplateBlockKind;
  disabled: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const { block, disabled, onChange } = props;
  const about = (
    <p className="text-sm text-muted-foreground">
      {t(`sales.documentTemplates.about.${block.type}`)}
    </p>
  );
  const toggle = (label: string, checked: boolean, set: (value: boolean) => void) => (
    <SwitchRow label={label} checked={checked} disabled={disabled} onChange={set} />
  );
  switch (block.type) {
    case 'HEADING':
      return (
        <div className="flex flex-col gap-3">
          {about}
          <FormField
            label={t('templateEditor.fields.title')}
            htmlFor="doc-heading-title"
            hint={t('sales.documentTemplates.titleHint', {
              title: t(`sales.printKinds.${props.kind}`),
            })}
          >
            <Input
              id="doc-heading-title"
              disabled={disabled}
              maxLength={DOCUMENT_TEMPLATE_LIMITS.maxTitle}
              value={block.title ?? ''}
              onChange={(event) => onChange({ title: event.target.value || null })}
            />
          </FormField>
          <ChoiceField
            label={t('templateEditor.fields.align')}
            value={block.align}
            options={RECEIPT_ALIGNS}
            name={(value) => t(`templateEditor.aligns.${value}`)}
            disabled={disabled}
            onChange={(align) => onChange({ align })}
          />
          {toggle(t('sales.documentTemplates.options.showCompany'), block.showCompany, (value) =>
            onChange({ showCompany: value }),
          )}
          {toggle(t('sales.documentTemplates.options.showTin'), block.showTin, (value) =>
            onChange({ showTin: value }),
          )}
          {toggle(
            t('sales.documentTemplates.options.showPrintedAt'),
            block.showPrintedAt,
            (value) => onChange({ showPrintedAt: value }),
          )}
        </div>
      );
    case 'ORDER_INFO':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {DOCUMENT_INFO_FIELDS.map((key) => (
            <SwitchRow
              key={key}
              label={t(`sales.documentTemplates.infoFields.${key}`)}
              checked={block.fields[key]}
              disabled={disabled}
              onChange={(value) => onChange({ fields: { ...block.fields, [key]: value } })}
            />
          ))}
        </div>
      );
    case 'LINES':
      return (
        <div className="flex flex-col gap-3">
          {about}
          <ol className="divide-y divide-border rounded-lg border border-border">
            {block.columns.map((column, index) => {
              const name = t(`sales.documentTemplates.columns.${column.key}`);
              const locked = DOCUMENT_REQUIRED_COLUMNS.includes(column.key);
              const swap = (to: number) => {
                const next = [...block.columns];
                const [item] = next.splice(index, 1);
                if (!item) return;
                next.splice(to, 0, item);
                onChange({ columns: next });
              };
              return (
                <li key={column.key} className="flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    aria-label={name}
                    checked={column.on}
                    disabled={disabled || locked}
                    onCheckedChange={(value) =>
                      onChange({
                        columns: block.columns.map((entry, at) =>
                          at === index ? { ...entry, on: value === true } : entry,
                        ),
                      })
                    }
                  />
                  <span className="flex-1 text-sm">{name}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('templateEditor.moveUp')}: ${name}`}
                    disabled={disabled || index === 0}
                    onClick={() => swap(index - 1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('templateEditor.moveDown')}: ${name}`}
                    disabled={disabled || index === block.columns.length - 1}
                    onClick={() => swap(index + 1)}
                  >
                    <ArrowDown />
                  </Button>
                </li>
              );
            })}
          </ol>
          {props.kind === 'PICK_LIST'
            ? toggle(t('sales.documentTemplates.options.byWarehouse'), block.byWarehouse, (value) =>
                onChange({ byWarehouse: value }),
              )
            : null}
        </div>
      );
    case 'TOTALS':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(t('sales.documentTemplates.options.showSubtotal'), block.showSubtotal, (value) =>
            onChange({ showSubtotal: value }),
          )}
          {toggle(t('sales.documentTemplates.options.showDiscount'), block.showDiscount, (value) =>
            onChange({ showDiscount: value }),
          )}
          {toggle(t('sales.documentTemplates.options.large'), block.large, (value) =>
            onChange({ large: value }),
          )}
        </div>
      );
    case 'SIGNATURES':
      return (
        <div className="flex flex-col gap-2">
          {about}
          {block.labels.map((label, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={t('sales.documentTemplates.signature', { number: index + 1 })}
                disabled={disabled}
                maxLength={DOCUMENT_TEMPLATE_LIMITS.maxSignature}
                value={label}
                onChange={(event) =>
                  onChange({
                    labels: block.labels.map((entry, at) =>
                      at === index ? event.target.value : entry,
                    ),
                  })
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${t('common.delete')}: ${label}`}
                disabled={disabled || block.labels.length <= 1}
                onClick={() => onChange({ labels: block.labels.filter((_, at) => at !== index) })}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled || block.labels.length >= DOCUMENT_TEMPLATE_LIMITS.maxSignatures}
            onClick={() => onChange({ labels: [...block.labels, ''] })}
          >
            <Plus />
            {t('sales.documentTemplates.addSignature')}
          </Button>
        </div>
      );
    default:
      return (
        <FreeBlockOptions
          block={block}
          disabled={disabled}
          variables={VARIABLES.map((key) => ({
            key,
            name: t(`sales.documentTemplates.variableNames.${key}`),
          }))}
          onChange={onChange}
        />
      );
  }
}

type DocumentTemplateBlockKind = DocumentTemplateDetail['kind'];
