import { POS_LIMITS, TENDER_KINDS, type TenderKind } from '@tugeel/shared/pos';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard } from '@/components/detail';
import { FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type PaymentType, usePaymentTypes, usePosMutations } from './api';

interface Draft {
  key: string;
  id: number | null;
  name: string;
  kind: TenderKind;
  active: boolean;
}

/**
 * «Төлбөрийн хэлбэрүүд» (ADR-0111): the ways to pay the till lists, in its order — a name, its kind
 * (cash, card terminal, bank transfer, credit), on or off the till. Saved as a whole list; a type is
 * never deleted, only taken off, and keeps its kind once saved. One cash type stays on.
 */
export function PaymentTypesCard() {
  const { t } = useTranslation();
  const types = usePaymentTypes();
  const canManage = useHasPermission('pos.manage');
  if (types.error) return <ProblemAlert problem={problemFromError(types.error)} />;
  if (!types.data) return null;
  const data = types.data;
  return (
    <DetailCard
      title={t('pos.paymentTypes.title')}
      canEdit={canManage}
      view={<PaymentTypesView types={data} />}
      edit={(close) => <PaymentTypesForm types={data} onClose={close} />}
    />
  );
}

function PaymentTypesView({ types }: { types: PaymentType[] }) {
  const { t } = useTranslation();
  return (
    <ol className="divide-y divide-border">
      {types.map((type, index) => (
        <li key={type.id} className="flex items-center gap-3 py-2 text-sm">
          <span className="w-6 font-mono text-muted-foreground">{String(index + 1)}</span>
          <span className="flex-1 font-medium">{type.name}</span>
          <span className="text-muted-foreground">{t(`pos.tenderKinds.${type.kind}`)}</span>
          <span className={type.status === 'ACTIVE' ? 'text-success' : 'text-muted-foreground'}>
            {t(`pos.statuses.${type.status}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PaymentTypesForm({ types, onClose }: { types: PaymentType[]; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePosMutations();
  const action = useAction();
  const [rows, setRows] = useState<Draft[]>(() =>
    types.map((type) => ({
      key: `id-${type.id}`,
      id: type.id,
      name: type.name,
      kind: type.kind,
      active: type.status === 'ACTIVE',
    })),
  );
  const [added, setAdded] = useState(0);
  const update = (key: string, patch: Partial<Draft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (row) next.splice(index + by, 0, row);
      return next;
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        await mutations.savePaymentTypes.mutateAsync({
          types: rows.map((row) => ({
            id: row.id,
            name: row.name.trim(),
            kind: row.kind,
            status: row.active ? 'ACTIVE' : 'INACTIVE',
          })),
        });
        toast.success(t('pos.paymentTypes.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className="text-sm text-muted-foreground">{t('pos.paymentTypes.hint')}</p>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex flex-wrap items-center gap-2">
            <span className="w-6 font-mono text-sm text-muted-foreground">{String(index + 1)}</span>
            <Input
              aria-label={t('pos.paymentTypes.name', { place: index + 1 })}
              className="min-w-48 flex-1"
              maxLength={POS_LIMITS.maxPaymentTypeName}
              value={row.name}
              onChange={(event) => update(row.key, { name: event.target.value })}
            />
            <NativeSelect
              aria-label={t('pos.paymentTypes.kind', { place: index + 1 })}
              className="w-40"
              value={row.kind}
              disabled={row.id !== null}
              onChange={(event) => update(row.key, { kind: event.target.value as TenderKind })}
            >
              {TENDER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`pos.tenderKinds.${kind}`)}
                </option>
              ))}
            </NativeSelect>
            <Switch
              aria-label={t('pos.paymentTypes.active', { place: index + 1 })}
              checked={row.active}
              onCheckedChange={(active) => update(row.key, { active })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('pos.paymentTypes.up', { place: index + 1 })}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('pos.paymentTypes.down', { place: index + 1 })}
              disabled={index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={rows.length >= POS_LIMITS.maxPaymentTypes}
        onClick={() => {
          setRows((current) => [
            ...current,
            { key: `new-${added}`, id: null, name: '', kind: 'CARD', active: true },
          ]);
          setAdded((count) => count + 1);
        }}
      >
        <Plus />
        {t('pos.paymentTypes.add')}
      </Button>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutations.savePaymentTypes.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
