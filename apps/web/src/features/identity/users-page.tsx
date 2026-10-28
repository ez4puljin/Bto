import { normalizeMnPhone } from '@tugeel/shared/phone';
import { Plus, Users } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useCreateParam } from '@/lib/use-create-param';
import { type PasswordCode, useIdentityMutations, useRoles, useUsers } from './api';
import { UserForm, type UserFormValues } from './user-form';

const EMPTY_USER: UserFormValues = {
  username: '',
  fullName: '',
  phone: '',
  roleIds: [],
  branchIds: [],
  warehouseIds: [],
};

/**
 * Staff accounts: search, list, and create with a one-time password code (SPEC §5.1). The create
 * dialog keeps «Болих» and «Хадгалах» in view while its sections scroll (ADR-0066).
 */
export function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('identity.users.manage');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const users = useUsers(deferredSearch);
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const [creating, setCreating] = useCreateParam();
  const [issued, setIssued] = useState<{ id: number; name: string; code: PasswordCode } | null>(
    null,
  );
  const roleById = useMemo(
    () => new Map((roles.data ?? []).map((role) => [role.id, role])),
    [roles.data],
  );
  const rows = users.data?.pages.flatMap((page) => page.data) ?? [];

  const create = async (values: UserFormValues) => {
    const user = await settle(
      mutations.createUser.mutateAsync({
        username: values.username,
        fullName: values.fullName,
        phone: values.phone ? normalizeMnPhone(values.phone) : null,
        roleIds: values.roleIds,
        scopes: { warehouseIds: values.warehouseIds, branchIds: values.branchIds },
      }),
    );
    if (!user) return;
    setCreating(false);
    const code = await settle(mutations.issueCode.mutateAsync(user.id));
    if (code) setIssued({ id: user.id, name: user.fullName, code });
    else await navigate(`/users/${user.id}`);
  };

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                mutations.createUser.reset();
                mutations.issueCode.reset();
                setCreating(true);
              }}
            >
              <Plus />
              {t('users.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('users.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(users.error)} onRetry={users.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.columns.username')}</TableHead>
              <TableHead>{t('users.columns.fullName')}</TableHead>
              <TableHead>{t('users.columns.roles')}</TableHead>
              <TableHead>{t('users.columns.status')}</TableHead>
              <TableHead>{t('users.columns.lastLogin')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((user) => (
              <LinkRow key={user.id} to={`/users/${user.id}`}>
                <TableCell>
                  <Link
                    to={`/users/${user.id}`}
                    className="font-mono font-medium underline-offset-4 hover:underline"
                  >
                    {user.username}
                  </Link>
                </TableCell>
                <TableCell>{user.fullName}</TableCell>
                <TableCell className="whitespace-normal">
                  {user.roleIds.map((id, index) => {
                    const role = roleById.get(id);
                    return (
                      <span key={id}>
                        {index > 0 ? ', ' : ''}
                        {role ? <RoleName role={role} /> : null}
                      </span>
                    );
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={user.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {t(`users.status.${user.status}`)}
                    </Badge>
                    {user.lockedUntil && Date.parse(user.lockedUntil) > Date.now() ? (
                      <Badge variant="destructive">{t('users.locked')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="font-mono">
                  {user.lastLoginAt
                    ? formatUbDateTime(Date.parse(user.lastLoginAt))
                    : t('common.none')}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!users.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('users.empty')}
            onClearFilters={search ? () => setSearch('') : undefined}
          />
        ) : null}
        <LoadMore query={users} />
      </ListCard>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t('users.create')}</DialogTitle>
            <DialogDescription>{t('users.form.createHint')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(mutations.createUser.error ?? mutations.issueCode.error)}
          />
          <UserForm
            inDialog
            defaultValues={EMPTY_USER}
            submitLabel={t('common.save')}
            onSubmit={create}
            onCancel={() => setCreating(false)}
          />
        </DialogContent>
      </Dialog>
      <CodeDialog
        code={issued?.code ?? null}
        name={issued?.name ?? ''}
        onClose={() => {
          const id = issued?.id;
          setIssued(null);
          if (id !== undefined) void navigate(`/users/${id}`);
        }}
      />
    </div>
  );
}
