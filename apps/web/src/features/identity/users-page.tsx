import { normalizeMnPhone } from '@tugeel/shared/phone';
import { Plus, Users } from 'lucide-react';
import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CodeDialog } from '@/components/code-dialog';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SegmentedControl,
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError, settle } from '@/lib/problem';
import { useCreateParam } from '@/lib/use-create-param';
import { localPhone } from '@/features/partners/phone';
import {
  type PasswordCode,
  type Role,
  useIdentityMutations,
  useRoles,
  type UserSummary,
  useUsers,
} from './api';
import { UserForm, type UserFormValues } from './user-form';

/** The staff list's columns (ADR-0119, ADR-0128): the phone first, the status may hold a second badge. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'fullName', kind: 'text', weight: 3, min: 12 },
  { key: 'phone', kind: 'code', width: 10 },
  { key: 'roles', kind: 'text', weight: 2, min: 10 },
  { key: 'status', kind: 'status', width: 11 },
  { key: 'lastLogin', kind: 'datetime' },
  { key: 'chevron', kind: 'chevron' },
];

/** The status views, in the URL as `?status=`; the active staff are the default view. */
const STATUS_FILTERS = ['ACTIVE', 'DISABLED', 'ALL'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const EMPTY_USER: UserFormValues = {
  fullName: '',
  phone: '',
  roleIds: [],
  branchIds: [],
  warehouseIds: [],
};

interface RoleGroup {
  key: string;
  role: Role | null;
  users: UserSummary[];
}

/**
 * The staff by role (owner 2026-10-31, ADR-0128 #6): one section per role in the roles' order, a
 * person with two roles under each of them, people without a role last under «Дүргүй». Done in
 * the browser from the loaded pages, which hold every staff member of an installation this size.
 */
function groupByRole(users: readonly UserSummary[], roles: readonly Role[]): RoleGroup[] {
  const groups: RoleGroup[] = [];
  for (const role of roles) {
    const members = users.filter((user) => user.roleIds.includes(role.id));
    if (members.length) groups.push({ key: String(role.id), role, users: members });
  }
  const known = new Set(roles.map((role) => role.id));
  const noRole = users.filter((user) => !user.roleIds.some((id) => known.has(id)));
  if (noRole.length) groups.push({ key: 'none', role: null, users: noRole });
  return groups;
}

/**
 * Staff accounts (SPEC §5.1, ADR-0128): the status segments and the search in the bar, the list in
 * sections per role, and «Ажилтан бүртгэх» with a one-time password code. A record without a phone
 * is flagged, since it still signs in by its old login name. The create dialog keeps «Болих» and
 * «Хадгалах» in view while its sections scroll (ADR-0066).
 */
export function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('identity.users.manage');
  const [params, setParams] = useSearchParams();
  const requested = params.get('status');
  const status: StatusFilter = STATUS_FILTERS.find((value) => value === requested) ?? 'ACTIVE';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const users = useUsers({ q: deferredSearch, status: status === 'ALL' ? undefined : status });
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
  const rows = useMemo(() => users.data?.pages.flatMap((page) => page.data) ?? [], [users.data]);
  const groups = useMemo(() => groupByRole(rows, roles.data ?? []), [rows, roles.data]);

  const create = async (values: UserFormValues) => {
    const user = await settle(
      mutations.createUser.mutateAsync({
        fullName: values.fullName,
        phone: normalizeMnPhone(values.phone) ?? values.phone,
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
        <SegmentedControl
          name={t('users.filters.status')}
          options={STATUS_FILTERS}
          value={status}
          label={(value) => t(`users.status.${value}`)}
          onChange={(value) =>
            setParams(value === 'ACTIVE' ? {} : { status: value }, { replace: true })
          }
        />
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('users.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(users.error)} onRetry={users.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.columns.fullName')}</TableHead>
              <TableHead>{t('users.columns.phone')}</TableHead>
              <TableHead>{t('users.columns.roles')}</TableHead>
              <TableHead>{t('users.columns.status')}</TableHead>
              <TableHead>{t('users.columns.lastLogin')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending ? <SkeletonRows columns={6} /> : null}
            {groups.map((group) => (
              <Fragment key={group.key}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={6} className="py-1.5 font-semibold">
                    <span className="flex items-center gap-2">
                      {group.role ? <RoleName role={group.role} /> : t('users.group.noRole')}
                      <span className="font-normal text-muted-foreground">
                        {t('users.group.count', { count: group.users.length })}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
                {group.users.map((user) => (
                  <LinkRow key={`${group.key}-${user.id}`} to={`/users/${user.id}`}>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell className="font-mono">
                      {user.phone ? (
                        localPhone(user.phone)
                      ) : (
                        <Badge variant="warning">{t('users.noPhone')}</Badge>
                      )}
                    </TableCell>
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
              </Fragment>
            ))}
          </TableBody>
        </ListTable>
        {!users.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('users.empty')}
            onClearFilters={
              search || status !== 'ACTIVE'
                ? () => {
                    setSearch('');
                    setParams({}, { replace: true });
                  }
                : undefined
            }
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
