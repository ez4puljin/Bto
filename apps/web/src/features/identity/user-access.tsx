import { describeClient } from '@tugeel/shared/device';
import { LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DetailCard, FieldList } from '@/components/detail';
import { RowAction, RowActions, TruncateCell } from '@/components/list';
import { RoleName } from '@/components/role-name';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  type UserDetail,
  useBranches,
  useIdentityMutations,
  useRoles,
  useUserSessionHistory,
  useUserSessions,
  useWarehouses,
} from './api';
import { UserAccessForm } from './user-form';

const when = (iso: string) => formatUbDateTime(Date.parse(iso));

/**
 * The account's roles and write scopes on the employee's page (ADR-0145), read first; «Засах» for
 * those who manage users. Nobody edits their own access (ADR-0027).
 */
export function UserAccessCard(props: {
  user: UserDetail;
  canManage: boolean;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useIdentityMutations();
  const { user } = props;
  return (
    <DetailCard
      title={t('users.detail.access')}
      canEdit={props.canManage && !props.isSelf}
      view={
        <div className="flex flex-col gap-3">
          {props.canManage && props.isSelf ? (
            <Alert>
              <AlertDescription>{t('users.detail.selfNote')}</AlertDescription>
            </Alert>
          ) : null}
          <AccessFacts user={user} />
        </div>
      }
      edit={(close) => (
        <UserAccessForm
          submitLabel={t('common.save')}
          onCancel={close}
          defaultValues={{
            roleIds: user.roleIds,
            branchIds: user.scopes.branchIds,
            warehouseIds: user.scopes.warehouseIds,
          }}
          onSubmit={async (values) => {
            const updated = await settle(
              mutations.updateUser.mutateAsync({
                id: user.id,
                body: {
                  roleIds: values.roleIds,
                  scopes: { warehouseIds: values.warehouseIds, branchIds: values.branchIds },
                },
              }),
            );
            if (updated) {
              toast.success(t('common.saved'));
              props.onChanged();
              close();
            }
          }}
        />
      )}
    />
  );
}

/** Which roles, and where they may write. */
function AccessFacts({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const roles = useRoles();
  const branches = useBranches();
  const warehouses = useWarehouses();
  const roleList = useMemo(
    () => (roles.data ?? []).filter((role) => user.roleIds.includes(role.id)),
    [roles.data, user.roleIds],
  );
  const names = (rows: readonly { id: number; code: string; name: string }[], ids: number[]) =>
    rows
      .filter((row) => ids.includes(row.id))
      .map((row) => `${row.code} · ${row.name}`)
      .join(', ');
  const branchNames = names(branches.data ?? [], user.scopes.branchIds);
  const warehouseNames = names(warehouses.data ?? [], user.scopes.warehouseIds);
  const everywhere = user.scopes.branchIds.length === 0 && user.scopes.warehouseIds.length === 0;
  return (
    <FieldList
      items={[
        {
          label: t('users.form.roles'),
          value: roleList.length
            ? roleList.map((role, index) => (
                <span key={role.id}>
                  {index > 0 ? ', ' : ''}
                  <RoleName role={role} />
                </span>
              ))
            : null,
        },
        ...(everywhere
          ? [{ label: t('users.form.scopes'), value: t('users.form.scopeAll') }]
          : [
              { label: t('users.form.scopeWarehouses'), value: warehouseNames || null },
              { label: t('users.form.scopeBranches'), value: branchNames || null },
            ]),
      ]}
    />
  );
}

type Asking = 'all' | { sessionId: string } | null;

/**
 * A session's device in words: our apps say their phone («samsung SM-A546E · Android 14 · Bto-staff
 * 0.19.0 · суулгац 3f2a9c1e»), a browser its name and system; anything else is shown as it came.
 */
function useDeviceText(): (userAgent: string | null) => string {
  const { t } = useTranslation();
  return (userAgent) => {
    const client = describeClient(userAgent);
    switch (client.kind) {
      case 'app':
        return t('users.detail.appOn', {
          device: client.device,
          os: client.os,
          app: client.app,
          version: client.appVersion,
          install: client.installId,
        });
      case 'browser':
        return client.os
          ? t('users.detail.browserOn', { browser: client.browser, os: client.os })
          : client.browser;
      case 'legacyApp':
        return t('users.detail.oldApp');
      case 'other':
        return client.raw;
      default:
        return t('users.detail.unknownDevice');
    }
  };
}

type EndReason = NonNullable<ReturnType<typeof useUserSessionHistory>['data']>[number]['endReason'];

/** The sign-in trail of the last 90 days, opened on demand under the live devices. */
function SessionHistory({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const history = useUserSessionHistory(userId, true);
  const deviceText = useDeviceText();
  const reason = (value: EndReason): string =>
    value === null
      ? t('users.detail.live')
      : t(`users.detail.endReasons.${value}`, { defaultValue: value });
  if (history.isPending) {
    return (
      <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (!history.data?.length) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{t('users.detail.noHistory')}</p>;
  }
  return (
    <Table aria-label={t('users.detail.history')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('users.detail.device')}</TableHead>
          <TableHead>{t('users.detail.address')}</TableHead>
          <TableHead>{t('users.detail.started')}</TableHead>
          <TableHead>{t('users.detail.ended')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.data.map((session) => (
          <TableRow key={session.id}>
            <TruncateCell text={deviceText(session.userAgent)} />
            <TableCell className="font-mono">{session.ip ?? t('common.none')}</TableCell>
            <TableCell className="font-mono">{when(session.createdAt)}</TableCell>
            <TableCell>
              {session.endedAt === null
                ? reason(null)
                : `${when(session.endedAt)} · ${reason(session.endReason)}`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The devices signed in to the account, each signed out after asking; «Түүх харах» opens the
 * sign-in trail under them.
 */
export function UserSessionsCard({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const sessions = useUserSessions(userId, true);
  const mutations = useIdentityMutations();
  const [asking, setAsking] = useState<Asking>(null);
  const [showHistory, setShowHistory] = useState(false);
  const deviceText = useDeviceText();
  const confirm = () => {
    if (asking === null) return;
    mutations.revokeSession.mutate(
      asking === 'all' ? { id: userId } : { id: userId, sessionId: asking.sessionId },
      { onSuccess: () => setAsking(null) },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.detail.sessions')}</CardTitle>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((shown) => !shown)}
          >
            {showHistory ? t('users.detail.hideHistory') : t('users.detail.showHistory')}
          </Button>
          {sessions.data?.length ? (
            <Button size="sm" variant="outline" onClick={() => setAsking('all')}>
              {t('users.detail.revokeAll')}
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      {/* The table runs to the card's edges: its first column lines up with the title. */}
      <CardContent className={sessions.data?.length ? 'px-0' : undefined}>
        {sessions.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.detail.device')}</TableHead>
                <TableHead>{t('users.detail.started')}</TableHead>
                <TableHead>{t('users.detail.lastUsed')}</TableHead>
                <TableHead>{t('users.detail.ends')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((session) => (
                <TableRow key={session.id}>
                  <TruncateCell
                    text={`${deviceText(session.userAgent)} · ${session.ip ?? t('common.none')}`}
                  />
                  <TableCell className="font-mono">{when(session.createdAt)}</TableCell>
                  <TableCell className="font-mono">{when(session.lastUsedAt)}</TableCell>
                  <TableCell className="font-mono">{when(session.expiresAt)}</TableCell>
                  <RowActions>
                    <RowAction
                      label={`${t('users.detail.revoke')}: ${session.ip ?? session.id}`}
                      icon={LogOut}
                      destructive
                      onClick={() => setAsking({ sessionId: session.id })}
                    />
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t('users.detail.noSessions')}</p>
        )}
      </CardContent>
      {showHistory ? (
        <CardContent className="border-t border-border/80 px-0">
          <p className="px-4 py-2 text-[0.75rem] text-muted-foreground">
            {t('users.detail.historyHint')}
          </p>
          <SessionHistory userId={userId} />
        </CardContent>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        title={asking === 'all' ? t('users.detail.revokeAllTitle') : t('users.detail.revokeTitle')}
        description={t('users.detail.revokeDescription')}
        confirmLabel={asking === 'all' ? t('users.detail.revokeAll') : t('users.detail.revoke')}
        pending={mutations.revokeSession.isPending}
        problem={problemFromError(mutations.revokeSession.error)}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
    </Card>
  );
}
