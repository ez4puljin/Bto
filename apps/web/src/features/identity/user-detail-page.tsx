import { normalizeMnPhone } from '@tugeel/shared/phone';
import { LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DetailCard, FieldList } from '@/components/detail';
import { RowAction, RowActions, TruncateCell } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { localPhone } from '@/features/partners/phone';
import {
  type PasswordCode,
  type UserDetail,
  useBranches,
  useIdentityMutations,
  useRoles,
  useUser,
  useUserSessions,
  useWarehouses,
} from './api';
import { UserForm, type UserFormValues } from './user-form';

const when = (iso: string) => formatUbDateTime(Date.parse(iso));

type Asking = 'code' | 'disable' | 'revokeAll' | { sessionId: string } | null;

/**
 * One staff account (SPEC §5.1), read first (ADR-0042 #7): username and state under the name; the
 * password code, unlock and disable at the top, each asked first where it changes access; the
 * account with its roles and write scopes in one card, «Засах» for those who manage users; the
 * signed-in devices.
 */
export function UserDetailPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const auth = useAuthState();
  const canManage = useHasPermission('identity.users.manage');
  const user = useUser(id);
  const sessions = useUserSessions(id, canManage);
  const mutations = useIdentityMutations();
  const [code, setCode] = useState<PasswordCode | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const isSelf = auth.status === 'authenticated' && auth.me.id === id;

  // Loading and refusals keep the page's frame, so the browser tab never shows the last page's name.
  if (user.isPending || user.isError) {
    return (
      <div>
        <PageHeader title={t('users.detail.title')} />
        {user.isError ? (
          <ProblemAlert problem={problemFromError(user.error)} onRetry={user.refetch} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        )}
      </div>
    );
  }
  const detail = user.data;
  const locked = detail.lockedUntil !== null && Date.parse(detail.lockedUntil) > Date.now();

  const save = async (values: UserFormValues) => {
    const updated = await settle(
      mutations.updateUser.mutateAsync({
        id,
        body: {
          fullName: values.fullName,
          phone: values.phone ? normalizeMnPhone(values.phone) : null,
          ...(isSelf
            ? {}
            : {
                roleIds: values.roleIds,
                scopes: { warehouseIds: values.warehouseIds, branchIds: values.branchIds },
              }),
        },
      }),
    );
    if (updated) toast.success(t('common.saved'));
    return updated !== null;
  };
  const confirm = () => {
    if (asking === 'code') {
      mutations.issueCode.mutate(id, {
        onSuccess: (issued) => {
          setAsking(null);
          setCode(issued);
        },
      });
    } else if (asking === 'disable') {
      mutations.updateUser.mutate(
        { id, body: { status: 'DISABLED' } },
        { onSuccess: () => setAsking(null) },
      );
    } else if (asking === 'revokeAll') {
      mutations.revokeSession.mutate({ id }, { onSuccess: () => setAsking(null) });
    } else if (asking) {
      mutations.revokeSession.mutate(
        { id, sessionId: asking.sessionId },
        { onSuccess: () => setAsking(null) },
      );
    }
  };
  const mutationProblem = problemFromError(
    mutations.updateUser.error ??
      mutations.issueCode.error ??
      mutations.unlockUser.error ??
      mutations.revokeSession.error,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.fullName}
        meta={
          <>
            <span className="font-mono">{detail.username}</span>
            <Badge variant={detail.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {t(`users.status.${detail.status}`)}
            </Badge>
            {!detail.passwordSet ? <Badge variant="warning">{t('users.noPassword')}</Badge> : null}
            {locked && detail.lockedUntil ? (
              <Badge variant="destructive">
                {t('users.detail.lockedUntil', { time: when(detail.lockedUntil) })}
              </Badge>
            ) : null}
          </>
        }
        actions={
          canManage ? (
            <>
              <Button variant="secondary" onClick={() => setAsking('code')}>
                {t('users.detail.issueCode')}
              </Button>
              {locked ? (
                <Button variant="outline" onClick={() => mutations.unlockUser.mutate(id)}>
                  {t('users.detail.unlock')}
                </Button>
              ) : null}
              {isSelf ? null : detail.status === 'ACTIVE' ? (
                <Button variant="outline" onClick={() => setAsking('disable')}>
                  {t('users.detail.disable')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => mutations.updateUser.mutate({ id, body: { status: 'ACTIVE' } })}
                >
                  {t('users.detail.enable')}
                </Button>
              )}
            </>
          ) : null
        }
      />
      <ProblemAlert problem={asking ? null : mutationProblem} />

      <DetailCard
        title={t('users.detail.profile')}
        canEdit={canManage}
        view={<UserFacts detail={detail} />}
        edit={(close) => (
          <div className="flex flex-col gap-4">
            {isSelf ? (
              <Alert>
                <AlertDescription>{t('users.detail.selfNote')}</AlertDescription>
              </Alert>
            ) : null}
            <UserForm
              lockUsername
              lockAccess={isSelf}
              submitLabel={t('common.save')}
              onCancel={close}
              onSubmit={async (values) => {
                if (await save(values)) close();
              }}
              defaultValues={{
                username: detail.username,
                fullName: detail.fullName,
                phone: detail.phone?.replace(/^\+976/, '') ?? '',
                roleIds: detail.roleIds,
                branchIds: detail.scopes.branchIds,
                warehouseIds: detail.scopes.warehouseIds,
              }}
            />
          </div>
        )}
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('users.detail.sessions')}</CardTitle>
            {sessions.data?.length ? (
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setAsking('revokeAll')}>
                  {t('users.detail.revokeAll')}
                </Button>
              </CardAction>
            ) : null}
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
                        text={`${session.ip ?? t('common.none')}${session.userAgent ? ` · ${session.userAgent}` : ''}`}
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
        </Card>
      ) : null}

      <ConfirmDialog
        open={asking === 'code'}
        variant="default"
        title={t('users.detail.issueCodeTitle')}
        description={t('users.detail.issueCodeDescription')}
        confirmLabel={t('users.detail.issueCode')}
        pending={mutations.issueCode.isPending}
        problem={problemFromError(mutations.issueCode.error)}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'disable'}
        title={t('users.detail.disableTitle')}
        description={t('users.detail.disableDescription')}
        confirmLabel={t('users.detail.disable')}
        pending={mutations.updateUser.isPending}
        problem={problemFromError(mutations.updateUser.error)}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'revokeAll' || (typeof asking === 'object' && asking !== null)}
        title={
          asking === 'revokeAll' ? t('users.detail.revokeAllTitle') : t('users.detail.revokeTitle')
        }
        description={t('users.detail.revokeDescription')}
        confirmLabel={
          asking === 'revokeAll' ? t('users.detail.revokeAll') : t('users.detail.revoke')
        }
        pending={mutations.revokeSession.isPending}
        problem={problemFromError(mutations.revokeSession.error)}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      />
      <CodeDialog code={code} name={detail.fullName} onClose={() => setCode(null)} />
    </div>
  );
}

/** The account read first: who, which roles, where they may write. */
function UserFacts({ detail }: { detail: UserDetail }) {
  const { t } = useTranslation();
  const roles = useRoles();
  const branches = useBranches();
  const warehouses = useWarehouses();
  const roleList = useMemo(
    () => (roles.data ?? []).filter((role) => detail.roleIds.includes(role.id)),
    [roles.data, detail.roleIds],
  );
  const names = (rows: readonly { id: number; code: string; name: string }[], ids: number[]) =>
    rows
      .filter((row) => ids.includes(row.id))
      .map((row) => `${row.code} · ${row.name}`)
      .join(', ');
  const branchNames = names(branches.data ?? [], detail.scopes.branchIds);
  const warehouseNames = names(warehouses.data ?? [], detail.scopes.warehouseIds);
  const everywhere =
    detail.scopes.branchIds.length === 0 && detail.scopes.warehouseIds.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <FieldList
        title={t('users.form.sectionAccount')}
        items={[
          { label: t('users.form.fullName'), value: detail.fullName },
          {
            label: t('users.form.username'),
            value: <span className="font-mono">{detail.username}</span>,
          },
          { label: t('users.form.phone'), value: detail.phone ? localPhone(detail.phone) : null },
        ]}
      />
      <FieldList
        title={t('users.detail.access')}
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
    </div>
  );
}
