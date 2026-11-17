import { Loader2, PlugZap, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatUbMinute } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useSmsSettings, useSmsSettingsMutations } from './api';
import { useSmsReason } from './sms-text';

/**
 * «Тохиргоо → SMS» (ADR-0216): WeSend's key, typed once and never shown again (only its last four
 * characters), «Холболт шалгах» showing the account's balance, and the switch that stops sending.
 */
export function SmsSettingsTab() {
  const { t } = useTranslation();
  const reason = useSmsReason();
  const settings = useSmsSettings();
  const mutations = useSmsSettingsMutations();
  const [key, setKey] = useState('');
  const [removing, setRemoving] = useState(false);
  const view = settings.data;
  const typed = key.trim();

  const saveKey = async () => {
    if (await settle(mutations.update.mutateAsync({ apiKey: typed }))) {
      setKey('');
      mutations.test.reset();
      toast.success(t('sms.settings.savedToast'));
    }
  };
  const removeKey = async () => {
    if (await settle(mutations.update.mutateAsync({ apiKey: null }))) {
      setRemoving(false);
      toast.success(t('sms.settings.savedToast'));
    }
  };
  const check = mutations.test.data;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card role="region" aria-labelledby="sms-settings-title">
        <CardHeader>
          <CardTitle id="sms-settings-title">{t('sms.settings.title')}</CardTitle>
          <CardDescription>{t('sms.settings.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProblemAlert
            problem={problemFromError(settings.error ?? mutations.update.error)}
            onRetry={settings.error ? settings.refetch : undefined}
          />
          {view ? (
            <>
              {!view.secretReady ? (
                <Alert variant="destructive">
                  <AlertDescription>{t('sms.settings.secretMissing')}</AlertDescription>
                </Alert>
              ) : null}
              {view.keyUnreadable ? (
                <Alert variant="destructive">
                  <AlertDescription>{t('sms.settings.unreadable')}</AlertDescription>
                </Alert>
              ) : null}
              <FormField
                label={t('sms.settings.apiKey')}
                htmlFor="sms-api-key"
                hint={`${
                  view.keyLast4
                    ? t('sms.settings.saved', { last4: view.keyLast4 })
                    : t('sms.settings.notSaved')
                } · ${t('sms.settings.apiKeyHint')}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="sms-api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    className="sm:w-80"
                    disabled={!view.secretReady}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={typed.length < 8 || mutations.update.isPending}
                    onClick={() => void saveKey()}
                  >
                    {t('sms.settings.save')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={mutations.test.isPending || (!typed && !view.hasKey)}
                    onClick={() => mutations.test.mutate(typed || undefined)}
                  >
                    {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                    {t('sms.settings.test')}
                  </Button>
                  {view.hasKey ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={mutations.update.isPending}
                      onClick={() => setRemoving(true)}
                    >
                      <Trash2 />
                      {t('sms.settings.remove')}
                    </Button>
                  ) : null}
                </div>
              </FormField>
              <ProblemAlert problem={problemFromError(mutations.test.error)} />
              {check ? (
                check.ok ? (
                  <p role="status" className="text-sm text-success">
                    {t('sms.settings.testOk', {
                      balance: formatTugrik(String(check.balance ?? 0)),
                    })}
                  </p>
                ) : (
                  <p role="alert" className="text-sm text-destructive">
                    {t('sms.settings.testFailed', { reason: reason(check.reason) })}
                  </p>
                )
              ) : null}
              <div className="flex items-start gap-3">
                <Switch
                  id="sms-enabled"
                  checked={view.enabled}
                  disabled={mutations.update.isPending}
                  onCheckedChange={(enabled) =>
                    void settle(mutations.update.mutateAsync({ enabled }))
                  }
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="sms-enabled">{t('sms.settings.enabled')}</Label>
                  <p className="text-xs text-muted-foreground">{t('sms.settings.enabledHint')}</p>
                </div>
              </div>
              {view.updatedAt && view.updatedBy ? (
                <p className="text-xs text-muted-foreground">
                  {t('sms.settings.updatedBy', {
                    who: view.updatedBy,
                    when: formatUbMinute(view.updatedAt),
                  })}
                </p>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={removing}
        title={t('sms.settings.removeTitle')}
        description={t('sms.settings.removeDescription')}
        confirmLabel={t('sms.settings.remove')}
        pending={mutations.update.isPending}
        onConfirm={() => void removeKey()}
        onClose={() => setRemoving(false)}
      />
    </div>
  );
}
