import {
  isLockedSetting,
  parseSettingValue,
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
} from '@tugeel/shared/settings';
import { businessDate } from '@tugeel/shared/time';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { RowAction, RowActions, RowActionSpacer } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { type SettingView, useIdentityMutations, useSettings } from './api';

type SettingEntry = SettingView['entries'][number];

/** Effective-dated settings: VAT and city-tax rates, payer flags, session length (SPEC §5.1). */
export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.hint')} />
      <ProblemAlert problem={problemFromError(settings.error)} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(settings.data ?? []).map((view) => (
          <SettingCard key={view.key} view={view} />
        ))}
      </div>
    </div>
  );
}

function SettingValue({
  settingKey,
  value,
}: {
  settingKey: SettingKey;
  value: string | number | boolean | null;
}) {
  const { t } = useTranslation();
  if (value === null) return <>{t('settings.notSet')}</>;
  if (SETTINGS[settingKey].kind === 'boolean') {
    return <>{value === true ? t('settings.true') : t('settings.false')}</>;
  }
  if (SETTINGS[settingKey].kind === 'code')
    return <span className="font-mono">{String(value)}</span>;
  return <>{String(value)}</>;
}

/**
 * One setting: its value today, its history and planned changes (a planned one can be deleted,
 * asked first), and «Шинэ утга» for a value from a date (ADR-0043: a dialog, yes/no as a switch).
 * A key fixed at installation (the Finance Core company code, ADR-0084 #3) is shown, never edited.
 */
function SettingCard({ view }: { view: SettingView }) {
  const { t } = useTranslation();
  const settingKey = view.key;
  const mayManage = useHasPermission('identity.settings.manage');
  const locked = isLockedSetting(settingKey);
  const canManage = mayManage && !locked;
  const mutations = useIdentityMutations();
  const [adding, setAdding] = useState(false);
  const deletion = useDeleteConfirm<SettingEntry>((id) => mutations.deleteSetting.mutateAsync(id));
  const today = businessDate();
  const inForceId = view.entries.find((entry) => entry.effectiveFrom <= today)?.id;
  const title = t(`settings.keys.${settingKey}`);

  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t('settings.current')}
          {': '}
          <span className="font-medium text-foreground">
            <SettingValue settingKey={settingKey} value={view.current} />
          </span>
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus />
              {t('settings.add')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      {/* The history runs to the card's edges, so its first column lines up with the title. */}
      <CardContent className={view.entries.length ? 'px-0' : undefined}>
        {locked ? (
          <p className="text-sm text-muted-foreground">{t('settings.locked')}</p>
        ) : view.entries.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.effectiveFrom')}</TableHead>
                <TableHead>{t('settings.value')}</TableHead>
                <TableHead>{t('users.columns.status')}</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.entries.map((entry) => {
                const upcoming = entry.effectiveFrom > today;
                const inForce = entry.id === inForceId;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono">{entry.effectiveFrom}</TableCell>
                    <TableCell>
                      <SettingValue settingKey={settingKey} value={entry.value} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={upcoming ? 'default' : inForce ? 'success' : 'secondary'}>
                        {upcoming
                          ? t('settings.upcoming')
                          : inForce
                            ? t('settings.inForce')
                            : t('settings.past')}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <RowActions>
                        {upcoming ? (
                          <RowAction
                            label={`${t('common.delete')}: ${entry.effectiveFrom}`}
                            icon={Trash2}
                            destructive
                            onClick={() => deletion.ask(entry)}
                          />
                        ) : (
                          <RowActionSpacer />
                        )}
                      </RowActions>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t('settings.noEntries')}</p>
        )}
      </CardContent>
      {adding ? (
        <SettingDialog
          settingKey={settingKey}
          first={view.entries.length === 0}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('settings.deleteTitle', { date: deletion.target?.effectiveFrom ?? '' })}
        description={title}
        confirmLabel={t('common.delete')}
        pending={deletion.pending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </Card>
  );
}

/** The typed value the API expects for a key, from the text the admin entered. */
function candidateValue(kind: SettingDefinition['kind'], raw: string, flag: boolean) {
  const text = raw.trim();
  if (kind === 'boolean') return flag;
  if (kind === 'integer') return /^\d{1,4}$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  return text;
}

function SettingDialog(props: { settingKey: SettingKey; first: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useIdentityMutations();
  const definition: SettingDefinition = SETTINGS[props.settingKey];
  const kind = definition.kind;
  const today = businessDate();
  const [raw, setRaw] = useState('');
  const [flag, setFlag] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [invalid, setInvalid] = useState(false);

  const save = async () => {
    const parsed = parseSettingValue(props.settingKey, candidateValue(kind, raw, flag));
    setInvalid(!parsed.ok);
    if (!parsed.ok || !effectiveFrom) return;
    const created = await settle(
      mutations.createSetting.mutateAsync({
        key: props.settingKey,
        value: parsed.value,
        effectiveFrom,
      }),
    );
    if (created) {
      toast.success(t('common.saved'));
      props.onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t(`settings.keys.${props.settingKey}`)}</DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(mutations.createSetting.error)} />
          {kind === 'boolean' ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="setting-value">{t('settings.value')}</Label>
              <div className="flex items-center gap-2.5">
                <span className="text-sm">{flag ? t('settings.true') : t('settings.false')}</span>
                <Switch id="setting-value" checked={flag} onCheckedChange={setFlag} />
              </div>
            </div>
          ) : (
            <FormField label={t('settings.value')} htmlFor="setting-value">
              <Input
                id="setting-value"
                className="font-mono sm:w-32"
                inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
                value={raw}
                aria-invalid={invalid}
                onChange={(event) => setRaw(event.target.value)}
              />
              {invalid ? (
                <p role="alert" className="text-sm text-destructive">
                  {kind === 'integer'
                    ? t('validation.integerRange', {
                        min: definition.min ?? 0,
                        max: definition.max ?? 9999,
                      })
                    : t('validation.percent')}
                </p>
              ) : null}
            </FormField>
          )}
          <FormField label={t('settings.effectiveFrom')} htmlFor="setting-date">
            <Input
              id="setting-date"
              type="date"
              className="sm:w-44"
              min={props.first ? undefined : today}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </FormField>
          <DialogFormFooter pending={mutations.createSetting.isPending} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
