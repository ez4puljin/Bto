import { Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { PanelSection } from '@/components/record-sheet';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { useUsers } from '@/features/identity/api';
import { placeName, useBoardTree, usePipeline } from '@/features/sales/pipelines-api';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ErxesCheck,
  type ErxesPipeline,
  type ErxesSettings,
  type ErxesUser,
  useErxesDirectoryMutations,
  useErxesPipelines,
  useErxesSettings,
  useErxesSettingsMutations,
  useErxesUsers,
} from './api';
import { FAILURE_KEYS } from './erxes-texts';

const failureText = (check: ErxesCheck) => FAILURE_KEYS[check.reason ?? 'UNEXPECTED_ANSWER'];

/**
 * The erxes settings (ADR-0218 #2, #3, #5): the sign-in of the erxes user Bto reads as and the
 * switch; the pipelines to copy, each with the Bto pipeline and stage its copies land in; and the
 * Bto user of each erxes user whose name does not say it.
 */
export function ErxesSettingsDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useErxesSettings(true);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('erxes.settings.title')}</DialogTitle>
          <DialogDescription>{t('erxes.settings.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(settings.error)}
          onRetry={settings.error ? settings.refetch : undefined}
        />
        {settings.data ? (
          <div className="flex flex-col gap-6">
            <SignInForm view={settings.data} />
            <Pipelines usable={settings.data.complete} />
            <Users />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignInForm({ view }: { view: ErxesSettings }) {
  const { t } = useTranslation();
  const mutations = useErxesSettingsMutations();
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [email, setEmail] = useState(view.email ?? '');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(view.enabled);
  const typed = { baseUrl: baseUrl.trim(), email: email.trim() };
  // A saved password belongs to the saved address: another address needs it typed again.
  const moved = typed.baseUrl !== view.baseUrl;
  const hasPassword = password !== '' || (view.hasPassword && !moved);
  const filled = typed.baseUrl !== '' && typed.email !== '';

  const save = async () => {
    const saved = await settle(
      mutations.update.mutateAsync({
        baseUrl: typed.baseUrl || null,
        email: typed.email || null,
        ...(password ? { password } : {}),
        enabled,
      }),
    );
    if (saved) {
      setPassword('');
      toast.success(t('common.saved'));
    }
  };
  const test = () =>
    mutations.test.mutate({
      ...(typed.baseUrl ? { baseUrl: typed.baseUrl } : {}),
      ...(typed.email ? { email: typed.email } : {}),
      ...(password ? { password } : {}),
    });
  const check = mutations.test.data;

  return (
    <PanelSection title={t('erxes.settings.signIn')}>
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
            <AlertDescription>{t('erxes.settings.secretMissing')}</AlertDescription>
          </Alert>
        ) : null}
        {view.passwordUnreadable ? (
          <Alert variant="destructive">
            <AlertDescription>{t('erxes.settings.passwordUnreadable')}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('erxes.settings.baseUrl')} htmlFor="erxes-base-url">
          <Input
            id="erxes-base-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            className="sm:w-96"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('erxes.settings.email')}
          htmlFor="erxes-email"
          hint={t('erxes.settings.emailHint')}
        >
          <Input
            id="erxes-email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            className="sm:w-96"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('erxes.settings.password')}
          htmlFor="erxes-password"
          hint={
            view.hasPassword && !moved
              ? t('erxes.settings.passwordSaved')
              : moved && view.hasPassword
                ? t('erxes.settings.passwordAgain')
                : t('erxes.settings.passwordHelp')
          }
        >
          <Input
            id="erxes-password"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            className="sm:w-96"
            disabled={!view.secretReady}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
          {t('erxes.settings.enabled')}
        </label>
        <ProblemAlert problem={problemFromError(mutations.update.error ?? mutations.test.error)} />
        {check ? (
          check.ok ? (
            <p role="status" className="text-sm text-success">
              {t('erxes.settings.testOk')}
            </p>
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {t(`erxes.failure.${failureText(check)}`)}
            </p>
          )
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={mutations.test.isPending || !filled || !hasPassword}
            onClick={test}
          >
            {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
            {mutations.test.isPending ? t('erxes.settings.testing') : t('erxes.settings.test')}
          </Button>
          <Button type="submit" pending={mutations.update.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </PanelSection>
  );
}

function Pipelines({ usable }: { usable: boolean }) {
  const { t } = useTranslation();
  const pipelines = useErxesPipelines(true);
  const mutations = useErxesDirectoryMutations();
  const action = useAction();
  const tree = useBoardTree();
  const options = useMemo(
    () =>
      (tree.data ?? []).flatMap((board) =>
        board.pipelines
          .filter((pipeline) => pipeline.archivedAt === null)
          .map((pipeline) => ({ id: pipeline.id, name: placeName(board.name, pipeline.name) })),
      ),
    [tree.data],
  );
  const rows = pipelines.data ?? [];

  const refresh = () =>
    void action.run(async () => {
      const check = await mutations.refresh.mutateAsync();
      if (check.ok) toast.success(t('erxes.settings.refreshed'));
      else toast.warning(t(`erxes.failure.${failureText(check)}`));
    });
  const update = (id: number, body: Parameters<typeof mutations.pipeline.mutateAsync>[0]['body']) =>
    void action.run(() => mutations.pipeline.mutateAsync({ id, body }));

  return (
    <PanelSection title={t('erxes.settings.pipelines')}>
      <p className="text-sm text-muted-foreground">{t('erxes.settings.pipelinesHelp')}</p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!usable}
          pending={mutations.refresh.isPending}
          onClick={refresh}
        >
          <RefreshCw />
          {t('erxes.settings.refresh')}
        </Button>
      </div>
      <ProblemAlert problem={problemFromError(pipelines.error) ?? action.problem} />
      {rows.length === 0 && !pipelines.isPending ? (
        <p className="text-sm text-muted-foreground">{t('erxes.settings.noPipelines')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <PipelineRow
              key={row.id}
              row={row}
              options={options}
              busy={mutations.pipeline.isPending}
              onChange={(body) => update(row.id, body)}
            />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function PipelineRow(props: {
  row: ErxesPipeline;
  options: { id: number; name: string }[];
  busy: boolean;
  onChange: (body: {
    enabled?: boolean;
    btoPipelineId?: number | null;
    btoStageId?: number | null;
  }) => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const pipeline = usePipeline(row.btoPipelineId);
  // A new order lands only in a live stage without an action.
  const stages = (pipeline.data?.stages ?? []).filter(
    (stage) => stage.archivedAt === null && stage.action === 'NONE',
  );
  const locked = row.blocked || row.gone;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
      <label className="flex min-w-56 flex-1 items-center gap-2.5">
        <Checkbox
          checked={row.enabled}
          disabled={locked || props.busy || (!row.enabled && row.btoStageId === null)}
          onCheckedChange={(checked) => props.onChange({ enabled: checked === true })}
        />
        <span>
          <span className="font-medium">{row.name}</span>{' '}
          <span className="text-muted-foreground">{row.boardName ?? ''}</span>
        </span>
        {row.blocked ? <Badge variant="secondary">{t('erxes.settings.blocked')}</Badge> : null}
        {row.gone ? <Badge variant="warning">{t('erxes.settings.gone')}</Badge> : null}
        {row.enabled && !row.placeOk ? (
          <Badge variant="destructive">{t('erxes.settings.placeBad')}</Badge>
        ) : null}
      </label>
      {locked ? null : (
        <>
          <NativeSelect
            aria-label={t('erxes.settings.btoPipeline')}
            className="h-9 w-64"
            disabled={props.busy}
            value={row.btoPipelineId === null ? '' : String(row.btoPipelineId)}
            onChange={(event) => {
              const id = Number.parseInt(event.target.value, 10);
              // A ticked pipeline keeps a place: it is unticked before its place is taken away.
              if (Number.isInteger(id)) props.onChange({ btoPipelineId: id });
              else if (!row.enabled) props.onChange({ btoPipelineId: null });
            }}
          >
            <option value="">{t('erxes.settings.choosePipeline')}</option>
            {props.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('erxes.settings.btoStage')}
            className="h-9 w-48"
            disabled={props.busy || row.btoPipelineId === null}
            value={row.btoStageId === null ? '' : String(row.btoStageId)}
            onChange={(event) => {
              const id = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(id)) props.onChange({ btoStageId: id });
            }}
          >
            {row.btoStageId === null ? (
              <option value="">{t('erxes.settings.chooseStage')}</option>
            ) : null}
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </NativeSelect>
        </>
      )}
    </li>
  );
}

function Users() {
  const { t } = useTranslation();
  const users = useErxesUsers(true);
  const mutations = useErxesDirectoryMutations();
  const action = useAction();
  const staff = useUsers({ status: 'ACTIVE' });
  const options = useMemo(
    () =>
      (staff.data?.pages.flatMap((page) => page.data) ?? []).map((user) => ({
        value: String(user.id),
        label: user.fullName,
      })),
    [staff.data],
  );
  const rows = users.data ?? [];
  return (
    <PanelSection title={t('erxes.settings.users')}>
      <p className="text-sm text-muted-foreground">{t('erxes.settings.usersHelp')}</p>
      <ProblemAlert problem={problemFromError(users.error) ?? action.problem} />
      {rows.length === 0 && !users.isPending ? (
        <p className="text-sm text-muted-foreground">{t('erxes.settings.noUsers')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <UserRow
              key={row.id}
              row={row}
              options={options}
              onChange={(btoUserId) =>
                void action.run(() => mutations.user.mutateAsync({ id: row.id, btoUserId }))
              }
            />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function UserRow(props: {
  row: ErxesUser;
  options: { value: string; label: string }[];
  onChange: (btoUserId: number | null) => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
      <span className="min-w-56 flex-1">
        <span className="font-medium">{row.fullName ?? row.email ?? row.erxesId}</span>{' '}
        <span className="text-muted-foreground">{row.email ?? ''}</span>
      </span>
      <SearchSelect
        aria-label={t('erxes.settings.btoUser')}
        className="w-64"
        value={row.btoUserId === null ? '' : String(row.btoUserId)}
        options={props.options}
        chosenLabel={row.btoUserName ?? undefined}
        placeholder={
          row.matchedUserName
            ? t('erxes.settings.userAuto', { name: row.matchedUserName })
            : t('erxes.settings.userNone')
        }
        onChange={(value) => props.onChange(Number.parseInt(value, 10) || null)}
        onClear={row.btoUserId === null ? undefined : () => props.onChange(null)}
      />
    </li>
  );
}
