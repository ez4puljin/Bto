import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type UserSummary = Schemas['UserSummary'];
export type UserDetail = Schemas['UserDetail'];
export type UserCreate = Schemas['UserCreateRequest'];
export type UserUpdate = Schemas['UserUpdateRequest'];
export type Role = Schemas['Role'];
export type PermissionInfo = Schemas['PermissionInfo'];
export type Branch = Schemas['Branch'];
export type BranchCreate = Schemas['BranchCreateRequest'];
export type BranchUpdate = Schemas['BranchUpdateRequest'];
export type Warehouse = Schemas['Warehouse'];
export type WarehouseCreate = Schemas['WarehouseCreateRequest'];
export type WarehouseUpdate = Schemas['WarehouseUpdateRequest'];
export type SettingView = Schemas['SettingView'];
export type SettingCreate = Schemas['SettingCreateRequest'];
export type AuditEntry = Schemas['AuditEntry'];
export type Session = Schemas['Session'];
export type PasswordCode = Schemas['PasswordCode'];

const KEYS = {
  users: ['identity', 'users'] as const,
  roles: ['identity', 'roles'] as const,
  branches: ['identity', 'branches'] as const,
  warehouses: ['identity', 'warehouses'] as const,
  settings: ['identity', 'settings'] as const,
  audit: ['identity', 'audit'] as const,
};

export function useUsers(search: string) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.users, 'list', search],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/users', {
          params: { query: { q: search || undefined, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.users, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/users/{id}', { params: { path: { id } }, signal })),
  });
}

export function useUserSessions(id: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.users, id, 'sessions'],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/users/{id}/sessions', { params: { path: { id } }, signal }))
        .data,
  });
}

export function useRoles() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.roles,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/roles', { signal })).data,
  });
}

export function usePermissionCatalog() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.roles, 'permissions'],
    staleTime: Infinity,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/permissions', { signal })).data,
  });
}

export function useBranches() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.branches,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/branches', { signal })).data,
  });
}

export function useWarehouses() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.warehouses,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/warehouses', { signal })).data,
  });
}

export function useSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/settings', { signal })).data,
  });
}

export interface AuditFilter {
  entity?: string;
  from?: string;
  to?: string;
}

export function useAudit(filter: AuditFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.audit, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/audit', {
          params: {
            query: {
              entity: filter.entity || undefined,
              from: filter.from || undefined,
              to: filter.to || undefined,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Mutations; each refreshes the lists it can change. */
export function useIdentityMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  return {
    createUser: useMutation({
      mutationFn: async (body: UserCreate) => unwrap(await api.POST('/api/v1/users', { body })),
      onSuccess: () => invalidate(KEYS.users, KEYS.roles),
    }),
    updateUser: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: UserUpdate }) =>
        unwrap(await api.PATCH('/api/v1/users/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.users, KEYS.roles),
    }),
    issueCode: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/users/{id}/password-code', { params: { path: { id } } })),
    }),
    unlockUser: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/users/{id}/unlock', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.users),
    }),
    revokeSession: useMutation({
      mutationFn: async ({ id, sessionId }: { id: number; sessionId?: string }) =>
        sessionId
          ? unwrap(
              await api.DELETE('/api/v1/users/{id}/sessions/{sessionId}', {
                params: { path: { id, sessionId } },
              }),
            )
          : unwrap(await api.DELETE('/api/v1/users/{id}/sessions', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.users),
    }),
    createRole: useMutation({
      mutationFn: async (body: Schemas['RoleCreateRequest']) =>
        unwrap(await api.POST('/api/v1/roles', { body })),
      onSuccess: () => invalidate(KEYS.roles),
    }),
    updateRole: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Schemas['RoleUpdateRequest'] }) =>
        unwrap(await api.PATCH('/api/v1/roles/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.roles, KEYS.users),
    }),
    deleteRole: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/roles/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.roles),
    }),
    createBranch: useMutation({
      mutationFn: async (body: BranchCreate) =>
        unwrap(await api.POST('/api/v1/branches', { body })),
      onSuccess: () => invalidate(KEYS.branches),
    }),
    updateBranch: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: BranchUpdate }) =>
        unwrap(await api.PATCH('/api/v1/branches/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.branches),
    }),
    createWarehouse: useMutation({
      mutationFn: async (body: WarehouseCreate) =>
        unwrap(await api.POST('/api/v1/warehouses', { body })),
      onSuccess: () => invalidate(KEYS.warehouses),
    }),
    updateWarehouse: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: WarehouseUpdate }) =>
        unwrap(await api.PATCH('/api/v1/warehouses/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.warehouses),
    }),
    createSetting: useMutation({
      mutationFn: async (body: SettingCreate) =>
        unwrap(await api.POST('/api/v1/settings', { body })),
      onSuccess: () => invalidate(KEYS.settings),
    }),
    deleteSetting: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/settings/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.settings),
    }),
  };
}
