import { RoleName } from '@/components/role-name';
import { useRoles } from '@/features/identity/api';

/** The roles as checkbox options, named as the roles page names them. */
export function useRoleOptions() {
  const roles = useRoles();
  return (roles.data ?? []).map((role) => ({ value: role.id, label: <RoleName role={role} /> }));
}
