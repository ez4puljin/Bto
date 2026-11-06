import { type Permission, PERMISSIONS } from '@tugeel/shared/auth';
import { Check, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { SegmentedControl } from '@/components/list';
import { RoleName } from '@/components/role-name';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Role, UserSummary } from './api';
import { groupPermissions } from './permission-groups';

const VIEWS = ['ALL', 'HELD', 'MISSING'] as const;
type View = (typeof VIEWS)[number];

/**
 * What one staff member may and may not do (owner 2026-11-06, ADR-0165 #5): every right of the
 * catalog per module, ticked when one of their roles grants it, with the roles that grant it. The
 * view (`?show=`) narrows it to the rights held or missing; the server's guard reads the same roles.
 */
export function StaffPermissions({ user, roles }: { user: UserSummary; roles: readonly Role[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('show');
  const view: View = VIEWS.find((value) => value === requested) ?? 'ALL';
  const held = useMemo(() => {
    const grantedBy = new Map<Permission, Role[]>();
    for (const role of roles) {
      if (!user.roleIds.includes(role.id)) continue;
      for (const code of role.permissions) {
        grantedBy.set(code, [...(grantedBy.get(code) ?? []), role]);
      }
    }
    return grantedBy;
  }, [roles, user.roleIds]);
  const shown = PERMISSIONS.filter((code) => {
    if (view === 'HELD') return held.has(code);
    if (view === 'MISSING') return !held.has(code);
    return true;
  });

  return (
    <Card aria-label={t('roles.staff.title', { name: user.fullName })} role="region">
      <CardHeader className="gap-3">
        <CardTitle>{t('roles.staff.title', { name: user.fullName })}</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            name={t('roles.staff.view')}
            options={VIEWS}
            value={view}
            label={(value) => t(`roles.staff.show.${value}`)}
            onChange={(value) =>
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (value === 'ALL') next.delete('show');
                  else next.set('show', value);
                  return next;
                },
                { replace: true },
              )
            }
          />
          <span className="text-sm text-muted-foreground">
            {t('roles.staff.counts', {
              held: held.size,
              missing: PERMISSIONS.length - held.size,
            })}
          </span>
        </div>
        {user.roleIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('roles.staff.noRole')}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('roles.staff.empty')}</p>
        ) : (
          <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
            {groupPermissions(shown).map(({ group, codes }) => (
              <section key={group} aria-label={t(`roles.groups.${group}`)}>
                <h3 className="mb-1.5 text-sm font-semibold">{t(`roles.groups.${group}`)}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {codes.map((code) => {
                    const grantors = held.get(code);
                    return (
                      <li key={code} className="flex items-start gap-2">
                        {grantors ? (
                          <Check
                            role="img"
                            aria-label={t('roles.staff.show.HELD')}
                            className="mt-0.5 size-4 shrink-0 text-success"
                          />
                        ) : (
                          <X
                            role="img"
                            aria-label={t('roles.staff.show.MISSING')}
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className={cn('min-w-0', !grantors && 'text-muted-foreground')}>
                          {t(`permissions.${code}`)}
                          {grantors ? (
                            <span className="text-muted-foreground">
                              {' · '}
                              {grantors.map((role, index) => (
                                <span key={role.id}>
                                  {index > 0 ? ', ' : ''}
                                  <RoleName role={role} />
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
