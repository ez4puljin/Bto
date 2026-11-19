import { EBARIMT_API_ENVIRONMENTS, type EbarimtApiEnvironment } from '@tugeel/shared/ebarimt-check';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCompany } from '@/features/company/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { type EbarimtConnection, useEbarimtConnection, useEbarimtMutations } from './api';
import { usePullTexts } from './pull-texts';

/**
 * «e-Barimt холболт» (ADR-0228): the environment, the sign-in, the tax authority's key, the
 * company's register and the nightly switch. The password and the key are typed here and never
 * shown again; a saved one reads «хадгалсан».
 */
export function ConnectionPanel(props: { onClose: () => void; onDirty: (dirty: boolean) => void }) {
  const connection = useEbarimtConnection();
  return (
    <>
      <ProblemAlert problem={problemFromError(connection.error)} onRetry={connection.refetch} />
      {connection.data ? (
        <ConnectionForm view={connection.data} onClose={props.onClose} onDirty={props.onDirty} />
      ) : null}
    </>
  );
}

function ConnectionForm(props: {
  view: EbarimtConnection;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { view } = props;
  const { t } = useTranslation();
  const canSave = useHasPermission('ebarimt.check.settings');
  const mutations = useEbarimtMutations();
  const action = useAction();
  const company = useCompany();
  const texts = usePullTexts();
  const [environment, setEnvironment] = useState<EbarimtApiEnvironment>(view.environment);
  const [username, setUsername] = useState(view.username ?? '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  // null: untouched, so the company's own register stands in for an empty one.
  const [register, setRegister] = useState<string | null>(null);
  const [nightly, setNightly] = useState(view.nightly);
  const companyRegister = company.data?.registerNo ?? company.data?.tin ?? '';
  const shownRegister = register ?? view.companyRegister ?? companyRegister;
  const prefilled = register === null && view.companyRegister === null && companyRegister !== '';
  // The real environment's password and key never go to the test one: another needs them again.
  const moved = environment !== view.environment;
  const passwordKept = view.hasPassword && !moved;
  const keyKept = view.hasApiKey && !moved;
  const touched = () => props.onDirty(true);

  const save = () =>
    void action
      .run(async () => {
        await mutations.saveConnection.mutateAsync({
          environment,
          username: username.trim() || null,
          ...(password ? { password } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          companyRegister: shownRegister.trim() || null,
          nightly,
        });
      })
      .then((done) => {
        if (!done) return;
        props.onDirty(false);
        toast.success(t('ebarimtCheck.connection.savedToast'));
        props.onClose();
      });

  const savedHint = (kept: boolean) =>
    kept
      ? t('ebarimtCheck.connection.savedHint')
      : moved
        ? t('ebarimtCheck.connection.typeAgain')
        : undefined;

  return (
    <form
      className="flex min-h-0 flex-col gap-4 overflow-auto"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save();
      }}
    >
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('ebarimtCheck.connection.description')}
      </p>
      {!view.secretReady ? (
        <Alert variant="destructive">
          <AlertDescription>{t('ebarimtCheck.connection.secretMissing')}</AlertDescription>
        </Alert>
      ) : null}
      {view.passwordUnreadable || view.apiKeyUnreadable ? (
        <Alert variant="destructive">
          <AlertDescription>{t('ebarimtCheck.connection.unreadable')}</AlertDescription>
        </Alert>
      ) : null}
      {view.lastPull ? (
        <p
          role="status"
          className={cn(
            'text-sm font-medium',
            view.lastPull.ok ? 'text-success' : 'text-destructive',
          )}
        >
          {texts.status(view.lastPull)}
        </p>
      ) : null}
      <fieldset disabled={!canSave} className="flex flex-col gap-4 @container">
        <FormField label={t('ebarimtCheck.connection.environment')}>
          <SegmentedControl
            name={t('ebarimtCheck.connection.environment')}
            size="field"
            options={EBARIMT_API_ENVIRONMENTS}
            value={environment}
            onChange={(value) => {
              setEnvironment(value);
              touched();
            }}
            label={(value) => t(`ebarimtCheck.connection.environments.${value}`)}
          />
        </FormField>
        {environment === 'PRODUCTION' ? (
          <p className="text-[0.8125rem] text-warning">
            {t('ebarimtCheck.connection.productionNote')}
          </p>
        ) : null}
        <div className="grid gap-4 @md:grid-cols-2">
          <FormField label={t('ebarimtCheck.connection.username')} htmlFor="ebarimt-username">
            <Input
              id="ebarimt-username"
              autoComplete="off"
              spellCheck={false}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                touched();
              }}
            />
          </FormField>
          <FormField
            label={t('ebarimtCheck.connection.companyRegister')}
            htmlFor="ebarimt-register"
            hint={prefilled ? t('ebarimtCheck.connection.registerFromCompany') : undefined}
          >
            <Input
              id="ebarimt-register"
              autoComplete="off"
              spellCheck={false}
              value={shownRegister}
              onChange={(event) => {
                setRegister(event.target.value);
                touched();
              }}
            />
          </FormField>
          <FormField
            label={t('ebarimtCheck.connection.password')}
            htmlFor="ebarimt-password"
            hint={savedHint(passwordKept)}
          >
            <Input
              id="ebarimt-password"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={passwordKept ? t('ebarimtCheck.connection.saved') : undefined}
              disabled={!view.secretReady}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                touched();
              }}
            />
          </FormField>
          <FormField
            label={t('ebarimtCheck.connection.apiKey')}
            htmlFor="ebarimt-api-key"
            hint={savedHint(keyKept)}
          >
            <Input
              id="ebarimt-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={keyKept ? t('ebarimtCheck.connection.saved') : undefined}
              disabled={!view.secretReady}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                touched();
              }}
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox
            checked={nightly}
            onCheckedChange={(checked) => {
              setNightly(checked === true);
              touched();
            }}
          />
          {t('ebarimtCheck.connection.nightly')}
        </label>
        <p className="-mt-2 text-[0.8125rem] text-muted-foreground">
          {t('ebarimtCheck.connection.nightlyHint')}
        </p>
      </fieldset>
      <ProblemAlert problem={action.problem} />
      {canSave ? (
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" pending={mutations.saveConnection.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('ebarimtCheck.connection.readOnly')}
        </p>
      )}
    </form>
  );
}
