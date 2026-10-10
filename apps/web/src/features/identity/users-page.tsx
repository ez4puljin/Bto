import { normalizeMnPhone } from '@tugeel/shared/phone';
import { Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
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
import { Input } from '@/components/ui/input';
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

/** Staff accounts: search, list, and create with a one-time password code (SPEC §5.1). */
export function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('identity.users.manage');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const users = useUsers(deferredSearch);
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const [creating, setCreating] = useState(false);
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
      <Input
        className="mb-4 max-w-sm"
        type="search"
        aria-label={t('common.search')}
        placeholder={t('users.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ProblemAlert problem={problemFromError(users.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.columns.username')}</TableHead>
            <TableHead>{t('users.columns.fullName')}</TableHead>
            <TableHead>{t('users.columns.roles')}</TableHead>
            <TableHead>{t('users.columns.status')}</TableHead>
            <TableHead>{t('users.columns.lastLogin')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <Link
                  to={`/users/${user.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {user.username}
                </Link>
              </TableCell>
              <TableCell>{user.fullName}</TableCell>
              <TableCell>
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
              <TableCell className="flex flex-wrap gap-1">
                <Badge variant={user.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                  {t(`users.status.${user.status}`)}
                </Badge>
                {user.lockedUntil && Date.parse(user.lockedUntil) > Date.now() ? (
                  <Badge variant="destructive">{t('users.locked')}</Badge>
                ) : null}
              </TableCell>
              <TableCell>
                {user.lastLoginAt
                  ? formatUbDateTime(Date.parse(user.lastLoginAt))
                  : t('common.none')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!users.isPending && rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t('users.empty')}</p>
      ) : null}
      {users.hasNextPage ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={users.isFetchingNextPage}
          onClick={() => void users.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={t('common.close')} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('users.create')}</DialogTitle>
            <DialogDescription>{t('users.form.createHint')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(mutations.createUser.error ?? mutations.issueCode.error)}
          />
          <UserForm defaultValues={EMPTY_USER} submitLabel={t('common.save')} onSubmit={create} />
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
