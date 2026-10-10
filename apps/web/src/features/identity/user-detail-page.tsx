import { normalizeMnPhone } from '@tugeel/shared/phone';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { type PasswordCode, useIdentityMutations, useUser, useUserSessions } from './api';
import { UserForm, type UserFormValues } from './user-form';

const when = (iso: string) => formatUbDateTime(Date.parse(iso));

/** One staff account: profile, roles and scopes, password code, lock, devices (SPEC §5.1). */
export function UserDetailPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const auth = useAuthState();
  const canManage = useHasPermission('identity.users.manage');
  const user = useUser(id);
  const sessions = useUserSessions(id, canManage);
  const mutations = useIdentityMutations();
  const [code, setCode] = useState<PasswordCode | null>(null);
  const [saved, setSaved] = useState(false);
  const isSelf = auth.status === 'authenticated' && auth.me.id === id;

  if (user.isPending) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (user.isError) return <ProblemAlert problem={problemFromError(user.error)} />;
  const detail = user.data;
  const locked = detail.lockedUntil !== null && Date.parse(detail.lockedUntil) > Date.now();

  const save = async (values: UserFormValues) => {
    setSaved(false);
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
    if (updated) setSaved(true);
  };
  const mutationProblem = problemFromError(
    mutations.updateUser.error ??
      mutations.issueCode.error ??
      mutations.unlockUser.error ??
      mutations.revokeSession.error,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.fullName}
        actions={
          <Button variant="outline" asChild>
            <Link to="/users">{t('common.back')}</Link>
          </Button>
        }
      />
      <ProblemAlert problem={mutationProblem} />
      <Card>
        <CardHeader>
          <CardTitle>{t('users.detail.profile')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{detail.username}</span>
            <Badge variant={detail.status === 'ACTIVE' ? 'secondary' : 'outline'}>
              {t(`users.status.${detail.status}`)}
            </Badge>
            {!detail.passwordSet ? <Badge variant="outline">{t('users.noPassword')}</Badge> : null}
            {locked && detail.lockedUntil ? (
              <Badge variant="destructive">
                {t('users.detail.lockedUntil', { time: when(detail.lockedUntil) })}
              </Badge>
            ) : null}
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
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
            </div>
          ) : null}
        </CardContent>
      </Card>

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
            {saved ? (
              <Alert>
                <AlertDescription>{t('common.saved')}</AlertDescription>
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('users.detail.sessions')}</CardTitle>
            {sessions.data?.length ? (
              <Button variant="outline" onClick={() => mutations.revokeSession.mutate({ id })}>
                {t('users.detail.revokeAll')}
              </Button>
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
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.data.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="max-w-64 truncate" title={session.userAgent ?? ''}>
                        {session.ip ?? t('common.none')}
                        {session.userAgent ? ` · ${session.userAgent}` : ''}
                      </TableCell>
                      <TableCell>{when(session.createdAt)}</TableCell>
                      <TableCell>{when(session.lastUsedAt)}</TableCell>
                      <TableCell>{when(session.expiresAt)}</TableCell>
                      <TableCell>
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
