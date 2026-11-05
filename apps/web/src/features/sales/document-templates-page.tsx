import { DOCUMENT_TEMPLATE_KINDS, type DocumentTemplateKind } from '@tugeel/shared/sales';
import { FileText, Plus, Star, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
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
  type DocumentTemplate,
  useDocumentTemplateMutations,
  useDocumentTemplates,
} from './document-templates-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'kind', kind: 'status' },
  { key: 'state', kind: 'text', weight: 1, min: 10 },
  { key: 'pipelines', kind: 'text', weight: 2, min: 10 },
  { key: 'publishedAt', kind: 'datetime' },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
  { key: 'chevron', kind: 'chevron' },
];

/**
 * «Падааны загвар» (ADR-0143): the pick list's and the delivery note's templates. One default of
 * each kind serves every pipeline that chose none; a pipeline picks another in its settings.
 */
export function DocumentTemplatesPage() {
  const { t } = useTranslation();
  const templates = useDocumentTemplates();
  const mutations = useDocumentTemplateMutations();
  const action = useAction();
  const [adding, setAdding] = useCreateParam();
  const [removing, setRemoving] = useState<DocumentTemplate | null>(null);

  return (
    <div>
      <PageHeader
        title={t('sales.documentTemplates.title')}
        description={t('sales.documentTemplates.description')}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus />
            {t('sales.documentTemplates.new')}
          </Button>
        }
      />
      <ProblemAlert problem={problemFromError(templates.error) ?? action.problem} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('templateEditor.fields.name')}</TableHead>
              <TableHead>{t('sales.documentTemplates.kind')}</TableHead>
              <TableHead>{t('sales.documentTemplates.state')}</TableHead>
              <TableHead>{t('sales.documentTemplates.pipelines')}</TableHead>
              <TableHead>{t('sales.documentTemplates.publishedAt')}</TableHead>
              <SpacerHead />
              <TableHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.isPending ? <SkeletonRows columns={8} /> : null}
            {(templates.data ?? []).map((template) => {
              const href = `/sales/document-templates/${template.id}`;
              return (
                <LinkRow key={template.id} to={href}>
                  <TableCell>
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`sales.printKinds.${template.kind}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {template.isDefault ? (
                        <Badge variant="success">{t('templateEditor.default')}</Badge>
                      ) : null}
                      <Badge variant="outline">
                        {t('templateEditor.version', { version: template.version })}
                      </Badge>
                      {template.hasDraft ? (
                        <Badge variant="warning">{t('templateEditor.draft')}</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {template.pipelines.length > 0
                      ? template.pipelines.map((pipeline) => pipeline.name).join(', ')
                      : template.isDefault
                        ? t('sales.documentTemplates.allOther')
                        : t('common.none')}
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(template.publishedAt))}
                  </TableCell>
                  <SpacerCell />
                  <RowActions>
                    <RowAction
                      label={`${t('templateEditor.makeDefault')}: ${template.name}`}
                      icon={Star}
                      disabled={template.isDefault}
                      onClick={() =>
                        void action.run(async () => {
                          await mutations.makeDefault.mutateAsync(template.id);
                          toast.success(t('templateEditor.defaultSet', { name: template.name }));
                        })
                      }
                    />
                    <RowAction
                      label={`${t('common.delete')}: ${template.name}`}
                      icon={Trash2}
                      destructive
                      disabled={template.isDefault || template.pipelines.length > 0}
                      onClick={() => setRemoving(template)}
                    />
                  </RowActions>
                </LinkRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!templates.isPending && (templates.data ?? []).length === 0 ? (
          <EmptyState icon={FileText} title={t('sales.documentTemplates.empty')} />
        ) : null}
      </ListCard>
      <Dialog open={adding} onOpenChange={(next) => (next ? undefined : setAdding(false))}>
        {adding ? (
          <CreateForm templates={templates.data ?? []} onClose={() => setAdding(false)} />
        ) : (
          <DialogContent closeLabel={t('common.close')} />
        )}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        title={t('sales.documentTemplates.removeTitle', { name: removing?.name ?? '' })}
        description={t('sales.documentTemplates.removeDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        pending={mutations.remove.isPending}
        problem={problemFromError(mutations.remove.error)}
        onConfirm={() => {
          if (!removing) return;
          void mutations.remove.mutateAsync(removing.id).then(
            () => {
              toast.success(t('sales.documentTemplates.removed'));
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

function CreateForm(props: { templates: readonly DocumentTemplate[]; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useDocumentTemplateMutations();
  const action = useAction();
  const defaultOf = (kind: DocumentTemplateKind) =>
    props.templates.find((entry) => entry.kind === kind && entry.isDefault)?.id ?? null;
  const [kind, setKind] = useState<DocumentTemplateKind>('DELIVERY_NOTE');
  const [name, setName] = useState('');
  const [copyFromId, setCopyFromId] = useState<number | null>(() => defaultOf('DELIVERY_NOTE'));
  const [checked, setChecked] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (name.trim() === '') return;
    void action.run(async () => {
      const created = await mutations.create.mutateAsync({ kind, name: name.trim(), copyFromId });
      toast.success(t('sales.documentTemplates.created'));
      void navigate(`/sales/document-templates/${created.id}`);
    });
  };

  return (
    <DialogContent size="sm" closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t('sales.documentTemplates.new')}</DialogTitle>
        <DialogDescription>{t('sales.documentTemplates.newDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('sales.documentTemplates.kind')} htmlFor="doc-template-kind">
          <NativeSelect
            id="doc-template-kind"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as DocumentTemplateKind;
              setKind(next);
              setCopyFromId(defaultOf(next));
            }}
          >
            {DOCUMENT_TEMPLATE_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.printKinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          label={t('templateEditor.fields.name')}
          htmlFor="doc-template-name"
          error={checked && name.trim() === '' ? 'validation.required' : undefined}
        >
          <Input
            id="doc-template-name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('sales.documentTemplates.copyFrom')} htmlFor="doc-template-copy">
          <NativeSelect
            id="doc-template-copy"
            value={copyFromId ?? ''}
            onChange={(event) =>
              setCopyFromId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('sales.documentTemplates.builtIn')}</option>
            {props.templates
              .filter((entry) => entry.kind === kind)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </NativeSelect>
        </FormField>
        <DialogFormFooter
          pending={mutations.create.isPending}
          onCancel={props.onClose}
          submitLabel={t('sales.documentTemplates.create')}
        />
      </form>
    </DialogContent>
  );
}
