import {
  EXPIRY_LIABILITY_NOTE_MAX,
  EXPIRY_LIABILITY_TYPES,
  type ExpiryLiabilityType,
} from '@tugeel/shared/expiry';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxGroup } from '@/components/checkbox-group';
import { DialogFormFooter, FormField } from '@/components/form';
import { SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type ExpiryItem, useExpiryLiabilityOptions, useExpiryMutations } from './api';

/** Adds what a record already names but the options no longer list (a person who has left). */
function withNamed<T extends { id: number }>(options: readonly T[], named: readonly T[]): T[] {
  return [...options, ...named.filter((one) => !options.some((option) => option.id === one.id))];
}

/** «Хариуцлага оноох» (ADR-0172 #4): a single choice, without a version (ADR-0172 #6). */
export function ExpiryLiabilityDialog(props: { item: ExpiryItem; onClose: () => void }) {
  const { t } = useTranslation();
  const { item } = props;
  const options = useExpiryLiabilityOptions(true);
  const mutations = useExpiryMutations();
  const action = useAction();
  const [type, setType] = useState<ExpiryLiabilityType>(item.liability.type);
  const [roleIds, setRoleIds] = useState(() => item.liability.roles.map((role) => role.id));
  const [userIds, setUserIds] = useState(() => item.liability.users.map((user) => user.id));
  const [note, setNote] = useState(item.liability.note ?? '');
  const [filter, setFilter] = useState('');

  const roles = useMemo(
    () => withNamed(options.data?.roles ?? [], item.liability.roles),
    [options.data, item.liability.roles],
  );
  const people = useMemo(
    () => withNamed(options.data?.users ?? [], item.liability.users),
    [options.data, item.liability.users],
  );
  const needle = filter.trim().toLocaleLowerCase();
  // Who is ticked stays in view whatever the box holds.
  const shownPeople = needle
    ? people.filter(
        (person) =>
          userIds.includes(person.id) || person.fullName.toLocaleLowerCase().includes(needle),
      )
    : people;
  const nobody = type === 'SPECIFIC' && roleIds.length === 0 && userIds.length === 0;

  const submit = async () => {
    const specific = type === 'SPECIFIC';
    const ok = await action.run(() =>
      mutations.setLiability.mutateAsync({
        id: item.id,
        body: {
          type,
          roleIds: specific ? roleIds : [],
          userIds: specific ? userIds : [],
          ...(type === 'NONE' ? {} : { note: note.trim() }),
        },
      }),
    );
    if (ok) {
      toast.success(t('expiry.liability.savedToast'));
      props.onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('expiry.liability.assign')}</DialogTitle>
          <DialogDescription>
            {t('expiry.liability.dialogDescription', {
              name: item.product.name,
              qty: formatQty(item.qtyTotal),
              unit: item.product.baseUomName,
            })}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <ProblemAlert problem={problemFromError(options.error)} onRetry={options.refetch} />
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <SegmentedControl
            name={t('expiry.liability.typeLabel')}
            options={EXPIRY_LIABILITY_TYPES}
            value={type}
            label={(value) => t(`expiry.liabilityType.${value}`)}
            onChange={setType}
          />
          {type === 'SPECIFIC' ? (
            <>
              <FormField
                label={t('expiry.liability.roles')}
                {...(nobody ? { hint: t('expiry.liability.needSomeone') } : {})}
              >
                <CheckboxGroup
                  name="expiry-liability-role"
                  options={roles.map((role) => ({
                    value: role.id,
                    label: <RoleName role={role} />,
                  }))}
                  value={roleIds}
                  onChange={setRoleIds}
                />
              </FormField>
              <FormField label={t('expiry.liability.people')}>
                <Input
                  type="search"
                  aria-label={t('expiry.liability.peopleFilter')}
                  placeholder={t('expiry.liability.peopleFilter')}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
                <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2">
                  {shownPeople.length > 0 ? (
                    <CheckboxGroup
                      name="expiry-liability-user"
                      options={shownPeople.map((person) => ({
                        value: person.id,
                        label: person.fullName,
                      }))}
                      value={userIds}
                      onChange={setUserIds}
                    />
                  ) : (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {t('expiry.liability.noPeople')}
                    </p>
                  )}
                </div>
              </FormField>
            </>
          ) : null}
          {/* NONE leaves no note behind (the server clears it), so it asks for none. */}
          {type === 'NONE' ? null : (
            <FormField label={t('expiry.liability.note')} htmlFor="expiry-liability-note">
              <Textarea
                id="expiry-liability-note"
                rows={2}
                maxLength={EXPIRY_LIABILITY_NOTE_MAX}
                placeholder={t('expiry.liability.notePlaceholder')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
          )}
          <DialogFormFooter
            pending={mutations.setLiability.isPending}
            disabled={nobody}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
