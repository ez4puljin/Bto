import { normalizeMnPhone } from '@tugeel/shared/phone';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
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
import { type PasswordCode, useIdentityMutations, useUser, useUserSessions } from './api';
import { UserForm, type UserFormValues } from './user-form';

const when = (iso: string) => formatUbDateTime(Date.parse(iso));

/**
 * One staff account (SPEC §5.1): its username and state under the name, the password code, unlock
 * and disable at the top (ADR-0042), then roles and scopes, and the signed-in devices.
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
  const isSelf = auth.status === 'authenticated' && auth.me.id === id;

  if (user.isPending) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (user.isError) return <ProblemAlert problem={problemFromError(user.error)} />;
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
              <Button
                variant="secondary"
                onClick={() => mutations.issueCode.mutate(id, { onSuccess: setCode })}
              >
                {t('users.detail.issueCode')}
              </Button>
              {locked ? (
                <Button variant="outline" onClick={() => mutations.unlockUser.mutate(id)}>
                  {t('users.detail.unlock')}
                </Button>
              ) : null}
              {!isSelf ? (
                <Button
                  variant={detail.status === 'ACTIVE' ? 'destructive' : 'outline'}
                  onClick={() =>
                    mutations.updateUser.mutate({
                      id,
                      body: { status: detail.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                    })
                  }
                >
                  {detail.status === 'ACTIVE'
                    ? t('users.detail.disable')
                    : t('users.detail.enable')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <ProblemAlert problem={mutationProblem} />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('users.detail.access')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isSelf ? (
              <Alert>
                <AlertDescription>{t('users.detail.selfNote')}</AlertDescription>
              </Alert>
            ) : null}
            <UserForm
              key={detail.updatedAt}
              lockUsername
              lockAccess={isSelf}
              submitLabel={t('common.save')}
              onSubmit={save}
              defaultValues={{
                username: detail.username,
                fullName: detail.fullName,
                phone: detail.phone?.replace(/^\+976/, '') ?? '',
                roleIds: detail.roleIds,
                branchIds: detail.scopes.branchIds,
                warehouseIds: detail.scopes.warehouseIds,
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('users.detail.sessions')}</CardTitle>
            {sessions.data?.length ? (
              <CardAction>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mutations.revokeSession.mutate({ id })}
                >
                  {t('users.detail.revokeAll')}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
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
                      <TableCell className="max-w-64 truncate" title={session.userAgent ?? ''}>
                        {session.ip ?? t('common.none')}
                        {session.userAgent ? ` · ${session.userAgent}` : ''}
                      </TableCell>
                      <TableCell className="font-mono">{when(session.createdAt)}</TableCell>
                      <TableCell className="font-mono">{when(session.lastUsedAt)}</TableCell>
                      <TableCell className="font-mono">{when(session.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            mutations.revokeSession.mutate({ id, sessionId: session.id })
                          }
                        >
                          {t('users.detail.revoke')}
                        </Button>
                      </TableCell>
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
      <CodeDialog code={code} name={detail.fullName} onClose={() => setCode(null)} />
    </div>
  );
}
