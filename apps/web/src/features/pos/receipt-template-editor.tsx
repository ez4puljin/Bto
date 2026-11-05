import {
  checkReceiptLayout,
  defaultReceiptLayout,
  newReceiptBlock,
  RECEIPT_ALIGNS,
  RECEIPT_CONDITIONAL_BLOCKS,
  RECEIPT_PAPERS,
  RECEIPT_REQUIRED_BLOCKS,
  RECEIPT_SINGLE_BLOCKS,
  RECEIPT_SIZES,
  RECEIPT_TEMPLATE_LIMITS,
  RECEIPT_TEXT_VARIABLES,
  RECEIPT_WHENS,
  type ReceiptBlock,
  type ReceiptBlockType,
  type ReceiptLayout,
} from '@tugeel/shared/pos';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
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
import { PAGE_RULES } from '@/lib/print-format';
import { problemFromError } from '@/lib/problem';
import { datesSummary } from '@/lib/template-history';
import { ReceiptView } from '@/pos/components/receipt-view';
import { RECEIPT_PRINT_WIDTH } from '@/pos/receipt-layout';
import { usePosSettings } from './api';
import { SAMPLE_SECRETS, sampleReceipt, type SampleOptions } from './receipt-sample';
import {
  type ReceiptTemplateDetail,
  useReceiptTemplate,
  useReceiptTemplateMutations,
} from './receipt-templates-api';

/** The blocks the admin may add, in the menu's order; the required ones are always there. */
const ADDABLE: readonly ReceiptBlockType[] = [
  'TEXT',
  'LOGO',
  'QR',
  'BARCODE',
  'DIVIDER',
  'SPACE',
  'LOYALTY',
  'FOOTER',
];

/**
 * A receipt template's editor (ADR-0141, ADR-0142) on the shared template editor (ADR-0143): the
 * paper and the text size, the receipt's blocks and their options, the receipt drawn live at the
 * paper's width with a made-up sale whose switches show a test, company, credit or member receipt.
 */
export function ReceiptTemplateEditorPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const template = useReceiptTemplate(id);
  if (template.error) {
    return (
      <div>
        <PageHeader title={t('pos.receiptTemplates.title')} />
        <ProblemAlert problem={problemFromError(template.error)} />
      </div>
    );
  }
  if (!template.data) return <PageHeader title={t('pos.receiptTemplates.title')} />;
  return <Editor key={template.data.id} template={template.data} />;
}

function Editor({ template }: { template: ReceiptTemplateDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const settings = usePosSettings({ enabled: canManage });
  const mutations = useReceiptTemplateMutations();
  const [sample, setSample] = useState<SampleOptions>({
    test: false,
    company: false,
    credit: false,
    member: false,
  });
  const catalog: EditorCatalog<ReceiptBlock> = {
    addable: ADDABLE,
    required: RECEIPT_REQUIRED_BLOCKS,
    single: RECEIPT_SINGLE_BLOCKS,
    maxBlocks: RECEIPT_TEMPLATE_LIMITS.maxBlocks,
    newBlock: newReceiptBlock,
    label: (type) => t(`pos.receiptTemplates.blocks.${type}`),
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
        case 'DIVIDER':
          return t(`templateEditor.rules.${block.rule}`);
        case 'SPACE':
          return t(`templateEditor.sizes.${block.size}`);
        default:
          return null;
      }
    },
    condition: (block) => {
      if (!RECEIPT_CONDITIONAL_BLOCKS.includes(block.type)) return null;
      const show = block as { when?: (typeof RECEIPT_WHENS)[number]; from?: string | null };
      const parts = [
        show.when && show.when !== 'ALWAYS' ? t(`pos.receiptTemplates.whens.${show.when}`) : null,
        datesSummary(block as { from?: string | null; to?: string | null }),
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? parts.join(' · ') : null;
    },
  };
  const receipt = sampleReceipt(
    template.kind,
    sample,
    settings.data?.receiptFooter ?? null,
    settings.data?.receiptTitle ?? null,
  );
  const draw = (layout: ReceiptLayout) => (
    <ReceiptView
      receipt={receipt}
      print={sample.credit ? null : SAMPLE_SECRETS}
      paper
      layout={layout}
      tillId={1}
      label={t('templateEditor.sections.preview')}
      copyLabel={sample.credit ? t('posKiosk.receipt.copyCustomer') : undefined}
    />
  );
  const check = (layout: ReceiptLayout) => {
    const result = checkReceiptLayout(layout);
    return result.ok ? null : result;
  };

  return (
    <TemplateEditor<ReceiptBlock, ReceiptLayout>
      template={{ ...template, kindLabel: t(`pos.receiptTemplates.kinds.${template.kind}`) }}
      canManage={canManage}
      catalog={catalog}
      check={check}
      builtIn={defaultReceiptLayout}
      maxName={RECEIPT_TEMPLATE_LIMITS.maxName}
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
        <>
          <ChoiceField
            label={t('templateEditor.fields.paper')}
            value={layout.paper}
            options={RECEIPT_PAPERS}
            name={(value) => t(`pos.receiptTemplates.papers.${value}`)}
            disabled={disabled}
            onChange={(paper) => set({ paper })}
          />
          <ChoiceField
            label={t('templateEditor.fields.size')}
            value={layout.size}
            options={RECEIPT_SIZES}
            name={(value) => t(`templateEditor.sizes.${value}`)}
            disabled={disabled}
            onChange={(size) => set({ size })}
          />
        </>
      )}
      options={(block, onChange, disabled) => (
        <BlockOptions
          block={block}
          disabled={disabled}
          storeTitle={settings.data?.receiptTitle ?? null}
          onChange={onChange}
        />
      )}
      previewControls={(['test', 'company', 'credit', 'member'] as const).map((key) => (
        <CheckToggle
          key={key}
          label={t(`pos.receiptTemplates.sample.${key}`)}
          checked={sample[key]}
          onChange={(checked) => setSample({ ...sample, [key]: checked })}
        />
      ))}
      preview={(layout) => (
        <div
          className="mx-auto bg-background shadow-control [zoom:1.25]"
          style={{ width: RECEIPT_PRINT_WIDTH[layout.paper] }}
        >
          {draw(layout)}
        </div>
      )}
      print={(layout) => ({
        content: draw(layout),
        width: RECEIPT_PRINT_WIDTH[layout.paper],
        pageRule: PAGE_RULES.MM80,
      })}
    />
  );
}

function BlockOptions(props: {
  block: ReceiptBlock;
  disabled: boolean;
  storeTitle: string | null;
  onChange: (patch: Partial<ReceiptBlock>) => void;
}) {
  const { t } = useTranslation();
  const { block, disabled } = props;
  const onChange = (patch: Record<string, unknown>) => props.onChange(patch);
  const about = (
    <p className="text-sm text-muted-foreground">{t(`pos.receiptTemplates.about.${block.type}`)}</p>
  );
  const toggle = (label: string, checked: boolean, key: string) => (
    <SwitchRow
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(value) => onChange({ [key]: value })}
    />
  );
  switch (block.type) {
    case 'HEADING':
      return (
        <div className="flex flex-col gap-3">
          {about}
          <FormField
            label={t('templateEditor.fields.title')}
            htmlFor="tpl-heading-title"
            hint={t('pos.receiptTemplates.titleHint', {
              title: props.storeTitle ?? t('pos.fields.none'),
            })}
          >
            <Textarea
              id="tpl-heading-title"
              rows={2}
              disabled={disabled}
              maxLength={RECEIPT_TEMPLATE_LIMITS.maxTitle}
              value={block.title ?? ''}
              onChange={(event) => onChange({ title: event.target.value || null })}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceField
              label={t('templateEditor.fields.align')}
              value={block.align}
              options={RECEIPT_ALIGNS}
              name={(value) => t(`templateEditor.aligns.${value}`)}
              disabled={disabled}
              onChange={(align) => onChange({ align })}
            />
            <ChoiceField
              label={t('templateEditor.fields.textSize')}
              value={block.size}
              options={RECEIPT_SIZES}
              name={(value) => t(`templateEditor.sizes.${value}`)}
              disabled={disabled}
              onChange={(size) => onChange({ size })}
            />
          </div>
          {toggle(t('pos.receiptTemplates.options.showCompany'), block.showCompany, 'showCompany')}
        </div>
      );
    case 'DOC_INFO':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(t('pos.receiptTemplates.options.showTill'), block.showTill, 'showTill')}
          {toggle(t('pos.receiptTemplates.options.showCashier'), block.showCashier, 'showCashier')}
        </div>
      );
    case 'LINES':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(t('pos.receiptTemplates.options.compact'), block.compact, 'compact')}
        </div>
      );
    case 'TOTALS':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(t('pos.receiptTemplates.options.large'), block.large, 'large')}
        </div>
      );
    case 'PAYMENTS':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(
            t('pos.receiptTemplates.options.showTendered'),
            block.showTendered,
            'showTendered',
          )}
        </div>
      );
    case 'BARCODE':
      return (
        <div className="flex flex-col gap-3">
          {about}
          {toggle(t('pos.receiptTemplates.options.showNumber'), block.showNumber, 'showNumber')}
        </div>
      );
    case 'TEXT':
    case 'LOGO':
    case 'QR':
    case 'DIVIDER':
    case 'SPACE':
      return (
        <div className="flex flex-col gap-3">
          {block.type === 'LOGO' || block.type === 'QR' ? about : null}
          <FreeBlockOptions
            block={block}
            disabled={disabled}
            variables={RECEIPT_TEXT_VARIABLES.map((key) => ({
              key,
              name: t(`pos.receiptTemplates.variableNames.${key}`),
            }))}
            whens={RECEIPT_WHENS.map((key) => ({
              key,
              name: t(`pos.receiptTemplates.whens.${key}`),
            }))}
            onChange={onChange}
          />
        </div>
      );
    default:
      return about;
  }
}
