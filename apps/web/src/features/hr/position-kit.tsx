import { useTranslation } from 'react-i18next';
import { RoleName } from '@/components/role-name';
import { Badge } from '@/components/ui/badge';
import { formatMnt } from '@/lib/money';
import type { Role } from '@/features/identity/api';
import type { HrPosition } from './workforce-api';

export function PositionPermissions({ permissions }: { permissions: readonly string[] }) {
  const { t } = useTranslation();
  const codes = [...new Set(permissions)];
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t('hr.positions.permissionsCount', { count: codes.length })}
      </summary>
      {codes.length ? (
        <ul className="mt-2 grid gap-1 text-xs text-muted-foreground @xl:grid-cols-2">
          {codes.map((code) => (
            <li key={code}>{t(`permissions.${code}`)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('hr.positions.noPermissions')}</p>
      )}
    </details>
  );
}

export function PositionRolePreview({ roles }: { roles: readonly Role[] }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {roles.map((role) => (
          <Badge key={role.id} variant="secondary">
            <RoleName role={role} />
          </Badge>
        ))}
      </div>
      <PositionPermissions permissions={roles.flatMap((role) => role.permissions)} />
    </div>
  );
}

export function PositionPreview({
  position,
  startMonth,
}: {
  position: HrPosition;
  startMonth?: string;
}) {
  const { t } = useTranslation();
  const scheduledSalary =
    position.nextEffectiveMonth === startMonth ? position.nextBaseSalary : position.baseSalary;
  return (
    <div className="@container space-y-2 rounded-lg bg-muted/40 p-3">
      {startMonth ? (
        <>
          <p className="text-sm">{t('hr.positions.assignmentHint', { month: startMonth })}</p>
          {scheduledSalary !== null ? (
            <p className="text-sm font-medium">
              {t('hr.positions.scheduledAmount', {
                amount: formatMnt(scheduledSalary),
                month: startMonth,
              })}
            </p>
          ) : null}
        </>
      ) : position.baseSalary !== null ? (
        <p className="text-sm font-medium">
          {t('hr.positions.currentAmount', { amount: formatMnt(position.baseSalary) })}
        </p>
      ) : null}
      {!startMonth && position.nextBaseSalary && position.nextEffectiveMonth ? (
        <p className="text-xs text-muted-foreground">
          {t('hr.positions.scheduledAmount', {
            amount: formatMnt(position.nextBaseSalary),
            month: position.nextEffectiveMonth,
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {position.roles.map((role) => (
          <Badge key={role.id} variant="secondary">
            <RoleName role={role} />
          </Badge>
        ))}
      </div>
      <PositionPermissions permissions={position.roles.flatMap((role) => role.permissions)} />
    </div>
  );
}
