import {
  AI_DATA_GROUPS,
  AI_MODEL_CATALOG,
  AI_PROVIDERS,
  aiDataPermission,
  type AiProvider,
} from '@tugeel/shared/ai';
import type { Permission } from '@tugeel/shared/auth';
import { Loader2, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DetailCard, FieldList } from '@/components/detail';
import { FormField, FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { type Role, useIdentityMutations, useRoles } from '../identity/api';
import {
  type AiCheck,
  type AiSettings,
  failureOf,
  useAiSettings,
  useAiSettingsMutations,
} from './ai-settings-api';

const OTHER_MODEL = '__other__';

/**
 * «Тохиргоо → AI» (ADR-0162): the connection with its key, the limits, and which data each role
 * may ask about. The assistant only ever reads, whatever is chosen here.
 */
export function AiSettingsTab() {
  const { t } = useTranslation();
  const settings = useAiSettings();
  const mayManageRoles = useHasPermission('identity.roles.manage');
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <ShieldCheck aria-hidden />
        <AlertDescription>{t('aiSettings.readOnly')}</AlertDescription>
      </Alert>
      <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
      {settings.data ? (
        <>
          <ConnectionCard view={settings.data} />
          <LimitsCard view={settings.data} />
        </>
      ) : null}
      {mayManageRoles ? <RightsCard /> : null}
    </div>
  );
}

function useProviderLabel() {
  const { t } = useTranslation();
  return (provider: AiProvider) => t(`aiSettings.connection.providers.${provider}`);
}

function CheckResult({ result }: { result: AiCheck }) {
  const { t } = useTranslation();
  if (result.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {t('aiSettings.connection.testOk')}
      </p>
    );
  }
  const { key, status } = failureOf(result);
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(`systemStatus.ai.failures.${key}`, { status })}
    </p>
  );
}

function ConnectionCard({ view }: { view: AiSettings }) {
  const { t } = useTranslation();
  const label = useProviderLabel();
  const mutations = useAiSettingsMutations();
  const [removing, setRemoving] = useState(false);

  const keyText = (() => {
    if (view.source === 'ENV') return t('aiSettings.connection.keyEnv');
    if (view.provider === 'ollama') return t('aiSettings.connection.keyNotNeeded');
    return view.keyHint ? `••••${view.keyHint}` : t('aiSettings.connection.keyNone');
  })();

  return (
    <>
      <DetailCard
        title={t('aiSettings.connection.title')}
        canEdit
        actions={
          <>
            {view.source === 'SETTINGS' ? (
              <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
                <Trash2 />
                {t('aiSettings.connection.remove')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={mutations.test.isPending || view.source === 'NONE' || !view.enabled}
              onClick={() => mutations.test.mutate({})}
            >
              {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {mutations.test.isPending
                ? t('aiSettings.connection.testing')
                : t('aiSettings.connection.test')}
            </Button>
          </>
        }
        view={
          <div className="flex flex-col gap-3">
            {view.keyUnreadable ? (
              <Alert variant="destructive">
                <AlertDescription>{t('aiSettings.connection.keyUnreadable')}</AlertDescription>
              </Alert>
            ) : null}
            {view.readerReady ? null : (
              <Alert variant="destructive">
                <AlertDescription>{t('aiSettings.connection.readerMissing')}</AlertDescription>
              </Alert>
            )}
            <FieldList
              items={[
                {
                  label: t('aiSettings.connection.enabled'),
                  value: (
                    <Switch
                      aria-label={t('aiSettings.connection.enabled')}
                      checked={view.enabled}
                      disabled={mutations.update.isPending}
                      onCheckedChange={(enabled) => mutations.update.mutate({ enabled })}
                    />
                  ),
                },
                {
                  label: t('aiSettings.connection.source'),
                  value: t(`aiSettings.connection.sources.${view.source}`),
                },
                {
                  label: t('aiSettings.connection.provider'),
                  value: view.provider ? label(view.provider) : null,
                },
                {
                  label: t('aiSettings.connection.model'),
                  value: view.model ? <span className="font-mono">{view.model}</span> : null,
                },
                { label: t('aiSettings.connection.key'), value: keyText },
                {
                  label: t('aiSettings.connection.price'),
                  value:
                    view.priceInputPerMtok !== null && view.priceOutputPerMtok !== null
                      ? t('aiSettings.connection.priceValue', {
                          input: view.priceInputPerMtok,
                          output: view.priceOutputPerMtok,
                        })
                      : t('aiSettings.connection.priceUnknown'),
                },
              ]}
            />
            {mutations.test.data ? <CheckResult result={mutations.test.data} /> : null}
            <ProblemAlert
              problem={problemFromError(mutations.test.error ?? mutations.update.error)}
            />
            {view.updatedAt && view.updatedBy ? (
              <p className="px-1 text-xs text-muted-foreground">
                {t('aiSettings.connection.updated', {
                  time: formatUbDateTime(Date.parse(view.updatedAt)),
                  name: view.updatedBy,
                })}
              </p>
            ) : null}
          </div>
        }
        edit={(close) => <ConnectionForm view={view} onClose={close} />}
      />
      <ConfirmDialog
        open={removing}
        title={t('aiSettings.connection.removeTitle')}
        description={t('aiSettings.connection.removeBody')}
        confirmLabel={t('common.delete')}
        pending={mutations.update.isPending}
        problem={problemFromError(mutations.update.error)}
        onClose={() => setRemoving(false)}
        onConfirm={() =>
          mutations.update.mutate({ provider: null }, { onSuccess: () => setRemoving(false) })
        }
      />
    </>
  );
}

/** The chosen model's published prices, or nothing for a model the catalog does not know. */
function catalogPrice(provider: AiProvider, model: string) {
  return AI_MODEL_CATALOG[provider].find((entry) => entry.id === model);
}

function ConnectionForm({ view, onClose }: { view: AiSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const label = useProviderLabel();
  const mutations = useAiSettingsMutations();
  // Starts from the connection in force, the .env's too, so saving a key changes nothing else.
  const initialProvider = view.provider ?? 'anthropic';
  const initialModel = view.model ?? AI_MODEL_CATALOG[initialProvider][0]?.id ?? '';
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [custom, setCustom] = useState(!catalogPrice(initialProvider, initialModel));
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(view.baseUrl ?? '');
  const known = catalogPrice(initialProvider, initialModel);
  const [priceInput, setPriceInput] = useState(view.priceInputPerMtok ?? known?.input ?? '');
  const [priceOutput, setPriceOutput] = useState(view.priceOutputPerMtok ?? known?.output ?? '');

  const models = AI_MODEL_CATALOG[provider];
  const keyless = provider === 'ollama';
  const keepsKey = view.source === 'SETTINGS' && view.provider === provider && !!view.keyHint;

  const chooseModel = (next: string) => {
    setModel(next);
    const price = catalogPrice(provider, next);
    if (price) {
      setPriceInput(price.input);
      setPriceOutput(price.output);
    }
  };
  const chooseProvider = (next: AiProvider) => {
    setProvider(next);
    setApiKey('');
    const first = AI_MODEL_CATALOG[next][0];
    setCustom(!first);
    setModel(first?.id ?? '');
    setPriceInput(first?.input ?? '');
    setPriceOutput(first?.output ?? '');
  };

  const typed = {
    provider,
    model: model.trim(),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(keyless && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
  };
  const canSave = Boolean(typed.model) && (keyless || keepsKey || Boolean(typed.apiKey));

  const save = async () => {
    const saved = await settle(
      mutations.update.mutateAsync({
        ...typed,
        ...(keyless
          ? {}
          : {
              priceInputPerMtok: priceInput.trim() || null,
              priceOutputPerMtok: priceOutput.trim() || null,
            }),
      }),
    );
    if (saved) {
      toast.success(t('common.saved'));
      onClose();
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {view.secretReady ? null : (
        <Alert variant="destructive">
          <AlertDescription>{t('aiSettings.connection.secretMissing')}</AlertDescription>
        </Alert>
      )}
      <ProblemAlert problem={problemFromError(mutations.update.error ?? mutations.test.error)} />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={t('aiSettings.connection.provider')} htmlFor="ai-provider">
          <NativeSelect
            id="ai-provider"
            value={provider}
            onChange={(event) => chooseProvider(event.target.value as AiProvider)}
          >
            {AI_PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('aiSettings.connection.model')} htmlFor="ai-model">
          {models.length > 0 ? (
            <NativeSelect
              id="ai-model"
              className="font-mono"
              value={custom ? OTHER_MODEL : model}
              onChange={(event) => {
                const next = event.target.value;
                setCustom(next === OTHER_MODEL);
                if (next !== OTHER_MODEL) chooseModel(next);
              }}
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
              <option value={OTHER_MODEL}>{t('aiSettings.connection.modelOther')}</option>
            </NativeSelect>
          ) : (
            <Input
              id="ai-model"
              className="font-mono"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
        </FormField>
        {custom && models.length > 0 ? (
          <FormField label={t('aiSettings.connection.modelCustom')} htmlFor="ai-model-custom">
            <Input
              id="ai-model-custom"
              className="font-mono"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </FormField>
        ) : null}
      </div>
      {keyless ? (
        <FormField label={t('aiSettings.connection.baseUrl')} htmlFor="ai-base-url">
          <Input
            id="ai-base-url"
            inputMode="url"
            placeholder="http://127.0.0.1:11434/api"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </FormField>
      ) : (
        <>
          <FormField
            label={t('aiSettings.connection.key')}
            htmlFor="ai-key"
            hint={t('aiSettings.connection.keyHelp')}
          >
            <Input
              id="ai-key"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              className="font-mono"
              disabled={!view.secretReady}
              placeholder={keepsKey ? t('aiSettings.connection.keyKeep') : undefined}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label={t('aiSettings.connection.priceInput')} htmlFor="ai-price-input">
              <Input
                id="ai-price-input"
                inputMode="decimal"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
            </FormField>
            <FormField label={t('aiSettings.connection.priceOutput')} htmlFor="ai-price-output">
              <Input
                id="ai-price-output"
                inputMode="decimal"
                value={priceOutput}
                onChange={(event) => setPriceOutput(event.target.value)}
              />
            </FormField>
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            {t('aiSettings.connection.pricesHelp')}
          </p>
        </>
      )}
      {mutations.test.data ? <CheckResult result={mutations.test.data} /> : null}
      <FormFooter>
        <Button
          type="button"
          variant="outline"
          className="mr-auto"
          disabled={mutations.test.isPending || !typed.model}
          onClick={() => mutations.test.mutate(typed)}
        >
          {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
          {mutations.test.isPending
            ? t('aiSettings.connection.testing')
            : t('aiSettings.connection.test')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!canSave || mutations.update.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

function LimitsCard({ view }: { view: AiSettings }) {
  const { t } = useTranslation();
  return (
    <DetailCard
      title={t('aiSettings.limits.title')}
      canEdit
      view={
        <FieldList
          items={[
            {
              label: t('aiSettings.limits.monthly'),
              value: view.monthlyBudgetUsd
                ? t('aiSettings.limits.monthlyValue', { value: view.monthlyBudgetUsd })
                : t('aiSettings.limits.none'),
              hint: t('aiSettings.limits.monthlyHelp'),
            },
            {
              label: t('aiSettings.limits.daily'),
              value:
                view.userDailyQuestions === null
                  ? t('aiSettings.limits.none')
                  : t('aiSettings.limits.dailyValue', { value: view.userDailyQuestions }),
              hint: t('aiSettings.limits.dailyHelp'),
            },
          ]}
        />
      }
      edit={(close) => <LimitsForm view={view} onClose={close} />}
    />
  );
}

function LimitsForm({ view, onClose }: { view: AiSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useAiSettingsMutations();
  const [monthly, setMonthly] = useState(view.monthlyBudgetUsd ?? '');
  const [daily, setDaily] = useState(
    view.userDailyQuestions === null ? '' : String(view.userDailyQuestions),
  );
  const dailyValid = daily.trim() === '' || /^[1-9]\d{0,3}$/.test(daily.trim());

  const save = async () => {
    if (!dailyValid) return;
    const saved = await settle(
      mutations.update.mutateAsync({
        monthlyBudgetUsd: monthly.trim() || null,
        userDailyQuestions: daily.trim() ? Number.parseInt(daily.trim(), 10) : null,
      }),
    );
    if (saved) {
      toast.success(t('common.saved'));
      onClose();
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <ProblemAlert problem={problemFromError(mutations.update.error)} />
      <FormField
        label={t('aiSettings.limits.monthly')}
        htmlFor="ai-monthly"
        hint={t('aiSettings.limits.monthlyHelp')}
      >
        <Input
          id="ai-monthly"
          inputMode="decimal"
          className="sm:w-40"
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
        />
      </FormField>
      <FormField
        label={t('aiSettings.limits.daily')}
        htmlFor="ai-daily"
        hint={t('aiSettings.limits.dailyHelp')}
      >
        <Input
          id="ai-daily"
          inputMode="numeric"
          className="sm:w-40"
          aria-invalid={!dailyValid}
          value={daily}
          onChange={(event) => setDaily(event.target.value)}
        />
      </FormField>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!dailyValid || mutations.update.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

/** ADMIN first and always everything, then the custom roles, whose switches save at once. */
function RightsCard() {
  const { t } = useTranslation();
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const shown = (roles.data ?? []).filter((role) => !role.isSystem || role.code === 'ADMIN');

  const toggle = (role: Role, code: Permission, on: boolean) =>
    mutations.updateRole.mutate({
      id: role.id,
      body: {
        permissions: on
          ? [...role.permissions, code]
          : role.permissions.filter((held) => held !== code),
      },
    });

  const rights: { code: Permission; label: string }[] = [
    { code: 'ai.ask', label: t('aiSettings.rights.ask') },
    ...AI_DATA_GROUPS.map((group) => ({
      code: aiDataPermission(group),
      label: t(`aiSettings.rights.groups.${group}`),
    })),
  ];

  return (
    <Card role="region" aria-labelledby="ai-rights-title">
      <CardHeader>
        <CardTitle id="ai-rights-title">{t('aiSettings.rights.title')}</CardTitle>
        <CardDescription>{t('aiSettings.rights.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <ProblemAlert problem={problemFromError(roles.error ?? mutations.updateRole.error)} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('aiSettings.rights.role')}</TableHead>
                {rights.map((right) => (
                  <TableHead key={right.code} className="text-center">
                    {right.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((role) => {
                const roleLabel =
                  role.code === 'ADMIN' ? t('roles.system.ADMIN') : (role.name ?? '');
                return (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      <RoleName role={role} />
                    </TableCell>
                    {rights.map((right) => (
                      <TableCell key={right.code}>
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={t('aiSettings.rights.toggle', {
                              role: roleLabel,
                              right: right.label,
                            })}
                            title={t(`permissions.${right.code}`)}
                            checked={role.permissions.includes(right.code)}
                            disabled={role.isSystem || mutations.updateRole.isPending}
                            onCheckedChange={(on) => toggle(role, right.code, on === true)}
                          />
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="px-4 text-xs text-muted-foreground">
          {t('aiSettings.rights.systemNote')}{' '}
          <Link className="text-primary underline-offset-2 hover:underline" to="/roles">
            {t('aiSettings.rights.openRoles')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
