import { RECEIPT_TEMPLATE_KINDS, type ReceiptTemplateKind } from '@tugeel/shared/pos';
import { Plus, ReceiptText, Star, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  LinkRow,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type ReceiptTemplate,
  useReceiptTemplateMutations,
  useReceiptTemplates,
} from './receipt-templates-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'kind', kind: 'status' },
  { key: 'state', kind: 'text', weight: 1, min: 10 },
  { key: 'tills', kind: 'text', weight: 2, min: 10 },
  { key: 'publishedAt', kind: 'datetime' },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
  { key: 'chevron', kind: 'chevron' },
];

/**
 * «Баримтын загвар» (ADR-0141): the receipts the POS print, laid out from blocks. One default of
 * each kind serves every POS that chose none; a POS picks another on «Пос».
 */
export function ReceiptTemplatesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const templates = useReceiptTemplates();
  const mutations = useReceiptTemplateMutations();
  const action = useAction();
  const [adding, setAdding] = useCreateParam();
  const [removing, setRemoving] = useState<ReceiptTemplate | null>(null);

  const makeDefault = (template: ReceiptTemplate) => {
    void action.run(async () => {
      await mutations.makeDefault.mutateAsync(template.id);
      toast.success(t('pos.receiptTemplates.defaultSet', { name: template.name }));
    });
  };

  return (
    <div>
      <PageHeader
        title={t('pos.receiptTemplates.title')}
        description={t('pos.receiptTemplates.description')}
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              {t('pos.receiptTemplates.new')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(templates.error) ?? action.problem} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.receiptTemplates.fields.name')}</TableHead>
              <TableHead>{t('pos.receiptTemplates.fields.kind')}</TableHead>
              <TableHead>{t('pos.receiptTemplates.fields.state')}</TableHead>
              <TableHead>{t('pos.receiptTemplates.fields.tills')}</TableHead>
              <TableHead>{t('pos.receiptTemplates.fields.publishedAt')}</TableHead>
              <SpacerHead />
              <TableHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.isPending ? <SkeletonRows columns={8} /> : null}
            {(templates.data ?? []).map((template) => {
              const href = `/pos/receipt-templates/${template.id}`;
              return (
                <LinkRow key={template.id} to={href}>
                  <TableCell>
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`pos.receiptTemplates.kinds.${template.kind}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {template.isDefault ? (
                        <Badge variant="success">{t('pos.receiptTemplates.default')}</Badge>
                      ) : null}
                      <Badge variant="outline">
                        {t('pos.receiptTemplates.version', { version: template.version })}
                      </Badge>
                      {template.hasDraft ? (
                        <Badge variant="warning">{t('pos.receiptTemplates.draft')}</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {template.tills.length > 0
                      ? template.tills.map((till) => till.name).join(', ')
                      : template.isDefault
                        ? t('pos.receiptTemplates.allOther')
                        : t('common.none')}
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(template.publishedAt))}
                  </TableCell>
                  <SpacerCell />
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={`${t('pos.receiptTemplates.makeDefault')}: ${template.name}`}
                          icon={Star}
                          disabled={template.isDefault}
                          onClick={() => makeDefault(template)}
                        />
                        <RowAction
                          label={`${t('common.delete')}: ${template.name}`}
                          icon={Trash2}
                          destructive
                          disabled={template.isDefault || template.tills.length > 0}
                          onClick={() => setRemoving(template)}
                        />
                      </>
                    ) : null}
                  </RowActions>
                </LinkRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!templates.isPending && (templates.data ?? []).length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('pos.receiptTemplates.empty')} />
        ) : null}
      </ListCard>
      <CreateDialog
        open={adding}
        templates={templates.data ?? []}
        onClose={() => setAdding(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={t('pos.receiptTemplates.removeTitle', { name: removing?.name ?? '' })}
        description={t('pos.receiptTemplates.removeDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        pending={mutations.remove.isPending}
        problem={problemFromError(mutations.remove.error)}
        onConfirm={() => {
          if (!removing) return;
          void mutations.remove.mutateAsync(removing.id).then(
            () => {
              toast.success(t('pos.receiptTemplates.removed'));
              setRemoving(null);
            },
            () => undefined,
          );
        }}
        onClose={() => {
          mutations.remove.reset();
          setRemoving(null);
        }}
      />
    </div>
  );
}

function CreateDialog(props: {
  open: boolean;
  templates: readonly ReceiptTemplate[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      {props.open ? (
        <CreateForm templates={props.templates} onClose={props.onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function CreateForm(props: { templates: readonly ReceiptTemplate[]; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useReceiptTemplateMutations();
  const action = useAction();
  const [kind, setKind] = useState<ReceiptTemplateKind>('SALE');
  const [name, setName] = useState('');
  const [copyFromId, setCopyFromId] = useState<number | null>(
    () => props.templates.find((entry) => entry.kind === 'SALE' && entry.isDefault)?.id ?? null,
  );
  const [checked, setChecked] = useState(false);
  const sources = props.templates.filter((entry) => entry.kind === kind);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (name.trim() === '') return;
    void action.run(async () => {
      const created = await mutations.create.mutateAsync({ kind, name: name.trim(), copyFromId });
      toast.success(t('pos.receiptTemplates.created'));
      void navigate(`/pos/receipt-templates/${created.id}`);
    });
  };

  return (
    <DialogContent size="sm" closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t('pos.receiptTemplates.new')}</DialogTitle>
        <DialogDescription>{t('pos.receiptTemplates.newDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('pos.receiptTemplates.fields.kind')} htmlFor="template-kind">
          <NativeSelect
            id="template-kind"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as ReceiptTemplateKind;
              setKind(next);
              setCopyFromId(
                props.templates.find((entry) => entry.kind === next && entry.isDefault)?.id ?? null,
              );
            }}
          >
            {RECEIPT_TEMPLATE_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`pos.receiptTemplates.kinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          label={t('pos.receiptTemplates.fields.name')}
          htmlFor="template-name"
          error={checked && name.trim() === '' ? 'validation.required' : undefined}
        >
          <Input
            id="template-name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('pos.receiptTemplates.fields.copyFrom')} htmlFor="template-copy">
          <NativeSelect
            id="template-copy"
            value={copyFromId ?? ''}
            onChange={(event) =>
              setCopyFromId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('pos.receiptTemplates.builtIn')}</option>
            {sources.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <DialogFormFooter
          pending={mutations.create.isPending}
          onCancel={props.onClose}
          submitLabel={t('pos.receiptTemplates.create')}
        />
      </form>
    </DialogContent>
  );
}
