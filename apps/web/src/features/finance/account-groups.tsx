import type { ProblemDetails } from '@tugeel/api-client';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { groupOptions, subtree } from './account-group-tree';
import { type GlAccountGroup, useFinanceMutations } from './api';

/** The core's code shape for a group (ADR-0239). */
const GROUP_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * A refused group change in the screen's own words (the field's text alone, ADR-0239), else the
 * usual alert.
 */
function GroupProblem({ problem }: { problem: ProblemDetails | null | undefined }) {
  const { t, i18n } = useTranslation();
  const first = problem?.errors?.[0];
  const key = first ? `errors.fields.${first.path}.${first.constraint}` : null;
  if (!problem || !key || !i18n.exists(key)) return <ProblemAlert problem={problem} />;
  // Field texts are looked up by a path built at run time, outside the typed keys.
  const plain = t as unknown as (key: string) => string;
  return (
    <Alert variant="destructive">
      <AlertDescription>{plain(key)}</AlertDescription>
    </Alert>
  );
}

/** «Бүлэг нэмэх» / «Дэд бүлэг нэмэх» (a parent given) and «Бүлэг засах» (a group given). */
export function GroupDialog(props: {
  groups: readonly GlAccountGroup[];
  group: GlAccountGroup | null;
  parentId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const { group } = props;
  const [code, setCode] = useState(group?.code ?? '');
  const [name, setName] = useState(group?.name ?? '');
  const [parentId, setParentId] = useState<number | null>(props.parentId);
  const [checked, setChecked] = useState(false);
  const codeOk = GROUP_CODE.test(code.trim());
  const parent = props.groups.find((row) => row.id === props.parentId);
  const title = group
    ? t('finance.accounts.groups.editTitle')
    : props.parentId === null
      ? t('finance.accounts.groups.add')
      : t('finance.accounts.groups.addChild');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if ((!group && !codeOk) || !name.trim()) return;
    void action
      .run(async () => {
        if (group) {
          await mutations.updateGroup.mutateAsync({ id: group.id, body: { name: name.trim() } });
          toast.success(t('finance.accounts.groups.saved'));
        } else {
          await mutations.createGroup.mutateAsync({
            code: code.trim(),
            name: name.trim(),
            parentId,
          });
          toast.success(t('finance.accounts.groups.created'));
        }
      })
      .then((ok) => {
        if (ok) props.onClose();
      });
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {group
              ? `${group.code} · ${group.name}`
              : parent
                ? `${parent.code} · ${parent.name}`
                : ''}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField
            label={t('finance.accounts.groups.code')}
            htmlFor="group-code"
            hint={group ? t('finance.accounts.groups.codeFixed') : undefined}
            error={!group && checked && !codeOk ? 'validation.required' : undefined}
          >
            <Input
              id="group-code"
              className="font-mono sm:w-44"
              value={code}
              maxLength={64}
              readOnly={group !== null}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('finance.accounts.groups.name')}
            htmlFor="group-name"
            error={checked && !name.trim() ? 'validation.required' : undefined}
          >
            <Input
              id="group-name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          {group ? null : (
            <FormField label={t('finance.accounts.groups.parent')} htmlFor="group-parent">
              <SearchSelect
                id="group-parent"
                value={parentId === null ? '' : String(parentId)}
                options={[
                  { value: '', label: t('finance.accounts.groups.root') },
                  ...groupOptions(props.groups),
                ]}
                onChange={(value) => setParentId(Number.parseInt(value, 10) || null)}
              />
            </FormField>
          )}
          <GroupProblem problem={action.problem} />
          <DialogFormFooter
            pending={mutations.createGroup.isPending || mutations.updateGroup.isPending}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Бүлэг зөөх»: a new parent, never the group itself or one below it. */
export function MoveGroupDialog(props: {
  groups: readonly GlAccountGroup[];
  group: GlAccountGroup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const { group } = props;
  const [parentId, setParentId] = useState<number | null>(group.parentId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        await mutations.updateGroup.mutateAsync({ id: group.id, body: { parentId } });
        toast.success(t('finance.accounts.groups.saved'));
      })
      .then((ok) => {
        if (ok) props.onClose();
      });
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.accounts.groups.moveTitle')}</DialogTitle>
          <DialogDescription>{`${group.code} · ${group.name}`}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={t('finance.accounts.groups.parent')} htmlFor="group-move-parent">
            <SearchSelect
              id="group-move-parent"
              value={parentId === null ? '' : String(parentId)}
              options={[
                { value: '', label: t('finance.accounts.groups.root') },
                ...groupOptions(props.groups, null, subtree(props.groups, group.id)),
              ]}
              onChange={(value) => setParentId(Number.parseInt(value, 10) || null)}
            />
          </FormField>
          <GroupProblem problem={action.problem} />
          <DialogFormFooter pending={mutations.updateGroup.isPending} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Бүлэг устгах»: asks first; a group holding an account or a sub-group is refused in place. */
export function DeleteGroupDialog(props: { group: GlAccountGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const confirm = () => {
    void action
      .run(async () => {
        await mutations.deleteGroup.mutateAsync(props.group.id);
        toast.success(t('finance.accounts.groups.deleted'));
      })
      .then((ok) => {
        if (ok) props.onClose();
      });
  };
  return (
    <ConfirmDialog
      open
      title={t('finance.accounts.groups.deleteTitle')}
      description={`${props.group.code} · ${props.group.name}. ${t('finance.accounts.groups.deleteQuestion')}`}
      confirmLabel={t('common.delete')}
      pending={mutations.deleteGroup.isPending}
      onConfirm={confirm}
      onClose={props.onClose}
    >
      <GroupProblem problem={action.problem} />
    </ConfirmDialog>
  );
}
