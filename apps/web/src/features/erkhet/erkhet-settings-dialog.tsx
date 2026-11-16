import { Loader2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import {
  type ErkhetCheck,
  type ErkhetSettings,
  useErkhetSettings,
  useErkhetSettingsMutations,
} from './api';

/** Which text explains a failed sign-in: the reason only, never Erkhet's own page. */
const FAILURE_KEYS = {
  LOGIN_FAILED: 'loginFailed',
  COMPANY_UNREACHABLE: 'companyUnreachable',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  UNEXPECTED_ANSWER: 'unexpectedAnswer',
  NOT_CONFIGURED: 'notConfigured',
  KEY_UNREADABLE: 'keyUnreadable',
} as const satisfies Record<NonNullable<ErkhetCheck['reason']>, string>;

/**
 * Erkhet's sign-in (ADR-0203 #2): the address, the company's number inside Erkhet, the name and
 * the password. The password is typed here and never shown again; «Холболт шалгах» signs in with
 * what is typed without saving it.
 */
export function ErkhetSettingsDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useErkhetSettings(true);
  const view = settings.data;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('erkhet.settings.title')}</DialogTitle>
          <DialogDescription>{t('erkhet.settings.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(settings.error)}
          onRetry={settings.error ? settings.refetch : undefined}
        />
        {view ? <SettingsForm view={view} onClose={props.onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ view, onClose }: { view: ErkhetSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useErkhetSettingsMutations();
  const [baseUrl, setBaseUrl] = useState(view.baseUrl ?? '');
  const [companyId, setCompanyId] = useState(view.companyId ?? '');
  const [username, setUsername] = useState(view.username ?? '');
  const [password, setPassword] = useState('');
  const [nightly, setNightly] = useState(view.nightly);
  const typed = {
    baseUrl: baseUrl.trim(),
    companyId: companyId.trim(),
    username: username.trim(),
  };
  // A saved password belongs to the saved address: another address needs it typed again.
  const moved = view.baseUrl !== null && typed.baseUrl !== view.baseUrl;
  const hasPassword = password !== '' || (view.hasPassword && !moved);
  const filled = typed.baseUrl !== '' && typed.companyId !== '' && typed.username !== '';

  const save = async () => {
    const saved = await settle(
      mutations.update.mutateAsync({
        baseUrl: typed.baseUrl || null,
        companyId: typed.companyId || null,
        username: typed.username || null,
        ...(password ? { password } : {}),
        nightly,
      }),
    );
    if (saved) {
      toast.success(t('common.saved'));
      onClose();
    }
  };
  const test = () =>
    mutations.test.mutate({
      ...(typed.baseUrl ? { baseUrl: typed.baseUrl } : {}),
      ...(typed.companyId ? { companyId: typed.companyId } : {}),
      ...(typed.username ? { username: typed.username } : {}),
      ...(password ? { password } : {}),
    });
  const check = mutations.test.data;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {!view.secretReady ? (
        <Alert variant="destructive">
          <AlertDescription>{t('erkhet.settings.secretMissing')}</AlertDescription>
        </Alert>
      ) : null}
      {view.passwordUnreadable ? (
        <Alert variant="destructive">
          <AlertDescription>{t('erkhet.settings.passwordUnreadable')}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        label={t('erkhet.settings.baseUrl')}
        htmlFor="erkhet-base-url"
        hint={t('erkhet.settings.baseUrlHint')}
      >
        <Input
          id="erkhet-base-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </FormField>
      <FormField
        label={t('erkhet.settings.companyId')}
        htmlFor="erkhet-company"
        hint={t('erkhet.settings.companyIdHint')}
      >
        <Input
          id="erkhet-company"
          inputMode="numeric"
          autoComplete="off"
          className="sm:w-60"
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
        />
      </FormField>
      <FormField label={t('erkhet.settings.username')} htmlFor="erkhet-username">
        <Input
          id="erkhet-username"
          autoComplete="off"
          spellCheck={false}
          className="sm:w-80"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </FormField>
      <FormField
        label={t('erkhet.settings.password')}
        htmlFor="erkhet-password"
        hint={
          view.hasPassword && !moved
            ? t('erkhet.settings.passwordSaved')
            : moved
              ? t('erkhet.settings.passwordAgain')
              : t('erkhet.settings.passwordHelp')
        }
      >
        <Input
          id="erkhet-password"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          className="sm:w-80"
          disabled={!view.secretReady}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox checked={nightly} onCheckedChange={(checked) => setNightly(checked === true)} />
        {t('erkhet.settings.nightly')}
      </label>
      <ProblemAlert problem={problemFromError(mutations.update.error ?? mutations.test.error)} />
      {check ? (
        check.ok ? (
          <p role="status" className="text-sm text-success">
            {t('erkhet.settings.testOk')}
          </p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {t(`erkhet.failure.${FAILURE_KEYS[check.reason ?? 'UNEXPECTED_ANSWER']}`)}
          </p>
        )
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={mutations.test.isPending || !filled || !hasPassword}
          onClick={test}
        >
          {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
          {mutations.test.isPending ? t('erkhet.settings.testing') : t('erkhet.settings.test')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" pending={mutations.update.isPending}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
