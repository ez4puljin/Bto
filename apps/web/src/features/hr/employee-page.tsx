import { isEmployeeLeft } from '@tugeel/shared/hr';
import { KeyRound, LogOut, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useIdentityMutations, useUser } from '@/features/identity/api';
import { UserAccessCard, UserSessionsCard } from '@/features/identity/user-access';
import { localPhone } from '@/features/partners/phone';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useRoleLabel } from './hr-helpers';
import { LeaveDialog, PhotoPicker, ResetPasswordDialog, StaffForm } from './staff-dialog';
import { StaffDetailsCard } from './community/staff-details-card';
import { type HrStaff, useStaff, useWorkforceMutations } from './workforce-api';

/**
 * One employee (ADR-0145): a staff user and an employee are one record, so the card, the sign-in and
 * the rights are read and changed here. HR keeps the card and marks who left; those who manage
 * users also give roles and scopes and sign devices out. The password is reset directly and the
 * employee signs in with the phone and that password.
 */
export function EmployeePage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const auth = useAuthState();
  const canManage = useHasPermission('hr.attendance.manage');
  const canReadUsers = useHasPermission('identity.users.read');
  const canManageUsers = useHasPermission('identity.users.manage');
  const list = useStaff();
  const user = useUser(id, canReadUsers);
  const identity = useIdentityMutations();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [leaving, setLeaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const staff = list.data?.find((row) => row.userId === id);

  if (!staff) {
    return (
      <div>
        <PageHeader title={t('hr.staff.dialog.editTitle')} />
        {list.isError ? (
          <ProblemAlert problem={problemFromError(list.error)} onRetry={list.refetch} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {list.isPending ? t('common.loading') : t('hr.staff.notFound')}
          </p>
        )}
      </div>
    );
  }

  const isSelf = auth.status === 'authenticated' && auth.me.id === id;
  const left = isEmployeeLeft(staff);
  const locked = staff.lockedUntil !== null && Date.parse(staff.lockedUntil) > Date.now();
  // Whoever does not manage users gives a password only to an account without roles (ADR-0145).
  const canReset = canManage && (canManageUsers || staff.roles.length === 0);
  const refresh = () => void list.refetch();

  const returnToWork = async () => {
    const ok = await action.run(() =>
      mutations.setLeft.mutateAsync({ userId: id, leftOn: null, reason: null, reasonKind: null }),
    );
    if (ok) toast.success(t('hr.staff.dialog.returned'));
  };
  const unlock = async () => {
    const ok = await action.run(() => identity.unlockUser.mutateAsync(id));
    if (ok) refresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={staff.fullName}
        meta={
          <>
            {staff.phone ? (
              <span className="font-mono">{localPhone(staff.phone)}</span>
            ) : (
              <Badge variant="warning">{t('users.noPhone')}</Badge>
            )}
            <Badge variant={left ? 'secondary' : 'success'}>
              {left ? t('hr.staff.statusLeft') : t('hr.staff.statusActive')}
            </Badge>
            {staff.passwordSet ? null : <Badge variant="warning">{t('users.noPassword')}</Badge>}
            {locked && staff.lockedUntil ? (
              <Badge variant="destructive">
                {t('users.detail.lockedUntil', {
                  time: formatUbDateTime(Date.parse(staff.lockedUntil)),
                })}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            {canReset ? (
              <Button variant="secondary" onClick={() => setResetting(true)}>
                <KeyRound />
                {t('hr.staff.reset.button')}
              </Button>
            ) : null}
            {locked && canManageUsers ? (
              <Button variant="outline" onClick={() => void unlock()}>
                {t('users.detail.unlock')}
              </Button>
            ) : null}
            {canManage && !isSelf ? (
              left ? (
                <Button variant="outline" onClick={() => void returnToWork()}>
                  <Undo2 />
                  {t('hr.staff.dialog.returnToWork')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setLeaving(true)}>
                  <LogOut />
                  {t('hr.staff.dialog.leave')}
                </Button>
              )
            ) : null}
          </>
        }
      />
      <ProblemAlert problem={action.problem} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <DetailCard
          title={t('hr.staff.dialog.editTitle')}
          canEdit={canManage}
          view={<CardFacts staff={staff} canManage={canManage} />}
          edit={(close) => <StaffForm staff={staff} onCancel={close} onSaved={close} />}
        />
        <div className="min-w-0">
          {canReadUsers && user.data ? (
            <UserAccessCard
              user={user.data}
              canManage={canManageUsers}
              isSelf={isSelf}
              onChanged={refresh}
            />
          ) : (
            <RolesCard roles={staff.roles} />
          )}
        </div>
        <StaffDetailsCard staff={staff} canManage={canManage} />
        {canManageUsers ? (
          <div className="min-w-0 xl:col-span-2">
            <UserSessionsCard userId={id} />
          </div>
        ) : null}
      </div>
      <LeaveDialog staff={staff} open={leaving} onClose={() => setLeaving(false)} />
      {resetting ? <ResetPasswordDialog staff={staff} onClose={() => setResetting(false)} /> : null}
    </div>
  );
}

/** `/users` before ADR-0145. */
export function OldUsersRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/hr/staff', search }} replace />;
}

/** `/users/:id` before ADR-0145. */
export function OldUserRedirect() {
  const { id } = useParams();
  return <Navigate to={`/hr/staff/${id ?? ''}`} replace />;
}

/** The card read first: the photo, then who they are in the company. */
function CardFacts({ staff, canManage }: { staff: HrStaff; canManage: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <PhotoPicker staff={staff} canManage={canManage} />
      <FieldList
        items={[
          { label: t('hr.staff.dialog.lastName'), value: staff.lastName },
          { label: t('hr.staff.dialog.firstName'), value: staff.firstName ?? staff.fullName },
          { label: t('hr.staff.dialog.position'), value: staff.position },
          { label: t('hr.staff.dialog.division'), value: staff.divisionName },
          {
            label: t('hr.staff.dialog.schedule'),
            value: staff.scheduleName ?? t('hr.companySchedule'),
          },
          {
            label: t('hr.staff.dialog.employmentType'),
            value: t(`hr.employmentTypes.${staff.employmentType}`),
          },
          {
            label: t('hr.staff.dialog.gender'),
            value: staff.gender ? t(`hr.genders.${staff.gender}`) : null,
          },
          { label: t('hr.staff.dialog.employedOn'), value: staff.employedOn },
          ...(staff.leftOn
            ? [
                { label: t('hr.staff.left.date'), value: staff.leftOn },
                {
                  label: t('hr.community.details.leftKind'),
                  value: staff.leftReasonKind
                    ? t(`hr.community.details.leftKinds.${staff.leftReasonKind}`)
                    : null,
                },
                { label: t('hr.staff.left.reason'), value: staff.leftReason },
              ]
            : []),
          {
            label: t('hr.staff.columns.lastLogin'),
            value: staff.lastLoginAt ? formatUbDateTime(Date.parse(staff.lastLoginAt)) : null,
          },
        ]}
      />
    </div>
  );
}

/** HR without the users' rights reads the roles only; they are given by those who manage users. */
function RolesCard({ roles }: { roles: readonly string[] }) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.detail.access')}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldList
          items={[
            { label: t('users.form.roles'), value: roles.length > 0 ? roleLabel(roles) : null },
          ]}
        />
      </CardContent>
    </Card>
  );
}
