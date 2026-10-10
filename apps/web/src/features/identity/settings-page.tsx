import { parseSettingValue, SETTINGS, type SettingKey } from '@tugeel/shared/settings';
import { businessDate } from '@tugeel/shared/time';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError, settle } from '@/lib/problem';
import { type SettingView, useIdentityMutations, useSettings } from './api';

/** Effective-dated settings: VAT and city-tax rates, payer flags, session length (SPEC §5.1). */
export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <p className="mb-4 text-sm text-muted-foreground">{t('settings.hint')}</p>
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
  return <>{String(value)}</>;
}

/** The typed value the API expects for a key, from the text the admin entered. */
function candidateValue(kind: 'percent' | 'boolean' | 'integer', raw: string) {
  const text = raw.trim();
  if (kind === 'boolean') return text === 'true';
  if (kind === 'integer') return /^\d{1,4}$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  return text;
}

function SettingCard({ view }: { view: SettingView }) {
  const { t } = useTranslation();
  const settingKey = view.key;
  const kind = SETTINGS[settingKey].kind;
  const canManage = useHasPermission('identity.settings.manage');
  const mutations = useIdentityMutations();
  const today = businessDate();
  const initialRaw = kind === 'boolean' ? 'true' : '';
  const [raw, setRaw] = useState(initialRaw);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [invalid, setInvalid] = useState(false);
  const inForceId = view.entries.find((entry) => entry.effectiveFrom <= today)?.id;

  const add = async () => {
    const parsed = parseSettingValue(settingKey, candidateValue(kind, raw));
    setInvalid(!parsed.ok);
    if (!parsed.ok || !effectiveFrom) return;
    const created = await settle(
      mutations.createSetting.mutateAsync({ key: settingKey, value: parsed.value, effectiveFrom }),
    );
    if (created) setRaw(initialRaw);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`settings.keys.${settingKey}`)}</CardTitle>
        <CardDescription>
          {t('settings.current')}
          {': '}
          <span className="font-medium text-foreground">
            <SettingValue settingKey={settingKey} value={view.current} />
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.entries.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.effectiveFrom')}</TableHead>
                <TableHead>{t('settings.value')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.entries.map((entry) => {
                const upcoming = entry.effectiveFrom > today;
                const inForce = entry.id === inForceId;
                return (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.effectiveFrom}</TableCell>
                    <TableCell>
                      <SettingValue settingKey={settingKey} value={entry.value} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={inForce ? 'secondary' : 'outline'}>
                          {upcoming
                            ? t('settings.upcoming')
                            : inForce
                              ? t('settings.inForce')
                              : t('settings.past')}
                        </Badge>
                        {upcoming && canManage ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={mutations.deleteSetting.isPending}
                            onClick={() => mutations.deleteSetting.mutate(entry.id)}
                          >
                            {t('common.delete')}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
        {canManage ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('settings.add')}</p>
            <ProblemAlert
              problem={problemFromError(
                mutations.createSetting.error ?? mutations.deleteSetting.error,
              )}
            />
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${settingKey}-value`}>{t('settings.value')}</Label>
                {kind === 'boolean' ? (
                  <NativeSelect
                    id={`${settingKey}-value`}
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                  >
                    <option value="true">{t('settings.true')}</option>
                    <option value="false">{t('settings.false')}</option>
                  </NativeSelect>
                ) : (
                  <Input
                    id={`${settingKey}-value`}
                    className="w-32"
                    inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
                    value={raw}
                    aria-invalid={invalid}
                    onChange={(event) => setRaw(event.target.value)}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${settingKey}-date`}>{t('settings.effectiveFrom')}</Label>
                <Input
                  id={`${settingKey}-date`}
                  type="date"
                  min={view.entries.length ? today : undefined}
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </div>
              <Button onClick={() => void add()} disabled={mutations.createSetting.isPending}>
                {t('common.save')}
              </Button>
            </div>
            {invalid ? (
              <p role="alert" className="text-sm text-destructive">
                {kind === 'integer' ? t('validation.hours') : t('validation.percent')}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
