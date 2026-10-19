import { isSystemRole } from '@tugeel/shared/auth';
import { useTranslation } from 'react-i18next';
import { useSignedIn } from './session';

/** The signed-in user's role as the app names it: a system role's Mongolian name, else its own. */
export function useRoleName(): string {
  const { t } = useTranslation();
  const { me } = useSignedIn();
  const role = me.roles[0];
  if (!role) return '';
  return isSystemRole(role.code) ? t(`roles.system.${role.code}`) : (role.name ?? '');
}
