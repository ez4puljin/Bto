import { isSystemRole } from '@tugeel/shared/auth';
import { useTranslation } from 'react-i18next';

/** A system role's Mongolian label, or the name an admin gave a custom role. */
export function RoleName({ role }: { role: { code: string | null; name: string | null } }) {
  const { t } = useTranslation();
  if (role.code && isSystemRole(role.code)) return <>{t(`roles.system.${role.code}`)}</>;
  return <>{role.name ?? role.code ?? ''}</>;
}
