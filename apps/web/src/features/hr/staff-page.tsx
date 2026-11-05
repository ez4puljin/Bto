import { isEmployeeLeft } from '@tugeel/shared/hr';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Check, Download, Plus, Users, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  ListTable,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { localPhone } from '@/features/partners/phone';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useCreateParam } from '@/lib/use-create-param';
import { useAction } from '@/lib/use-action';
import { useRoleLabel } from './hr-helpers';
import { Avatar } from './hr-kit';
import { useRequestWhen } from './request-helpers';
import { StaffCreateDialog } from './staff-dialog';
import {
  type HrStaff,
  type HrTimeRequest,
  useDivisions,
  useHrDownloads,
  usePendingRequests,
  useStaff,
  useWorkforceMutations,
} from './workforce-api';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 14 },
  { key: 'division', kind: 'text', weight: 2, min: 9 },
  { key: 'phone', kind: 'code', width: 7.5 },
  { key: 'roles', kind: 'text', weight: 2, min: 9 },
  { key: 'schedule', kind: 'text', weight: 2, min: 8 },
  { key: 'when', kind: 'datetime' },
  { key: 'status', kind: 'status', width: 8.5 },
  { key: 'chevron', kind: 'chevron' },
];

/** «Ажиллаж буй», or «Гарсан» for anybody whose account is closed (ADR-0145); a lock-out beside it. */
function StaffStatus({ staff }: { staff: HrStaff }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      {isEmployeeLeft(staff) ? (
        <Badge variant="outline">{t('hr.staff.statusLeft')}</Badge>
      ) : (
        <Badge variant="success">{t('hr.staff.statusActive')}</Badge>
      )}
      {staff.lockedUntil && Date.parse(staff.lockedUntil) > Date.now() ? (
        <Badge variant="destructive">{t('users.locked')}</Badge>
      ) : null}
    </div>
  );
}

/** The pending requests above the list, each with «Зөвшөөрөх» and «Татгалзах» (timely's cards). */
function PendingCards(props: {
  requests: readonly HrTimeRequest[];
  photos: Map<number, string | null>;
}) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const when = useRequestWhen();
  const shown = props.requests.slice(0, 4);
  const decide = async (request: HrTimeRequest, approve: boolean) => {
    const ok = await action.run(() =>
      mutations.decide.mutateAsync({ id: request.id, approve, note: null }),
    );
    if (ok) toast.success(approve ? t('hr.requests.approved') : t('hr.requests.rejected'));
  };
  return (
    <section aria-label={t('hr.staff.pending.title')} className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[0.9375rem] font-semibold">{t('hr.staff.pending.title')}</h2>
        <Badge variant="warning">{props.requests.length}</Badge>
        <Link
          to="/hr/requests?status=PENDING"
          className="ml-auto text-[0.8125rem] text-link hover:underline"
        >
          {t('hr.staff.pending.more', { count: props.requests.length })}
        </Link>
      </div>
      <ProblemAlert problem={action.problem} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((request) => (
          <article
            key={request.id}
            className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-control"
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={request.fullName} src={props.photos.get(request.userId) ?? null} />
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-semibold">{request.fullName}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: request.color }}
                  />
                  <span className="truncate">{request.typeName}</span>
                </p>
              </div>
            </div>
            <p className="text-xs text-foreground">{when(request)}</p>
            {request.note ? (
              <p className="line-clamp-2 text-xs text-muted-foreground" title={request.note}>
                {request.note}
              </p>
            ) : null}
            <div className="mt-auto flex gap-2">
              <Button
                size="xs"
                className="flex-1"
                aria-label={t('hr.requests.approveFor', { name: request.fullName })}
                onClick={() => void decide(request, true)}
              >
                <Check />
                {t('hr.requests.approve')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="flex-1"
                aria-label={t('hr.requests.rejectFor', { name: request.fullName })}
                onClick={() => void decide(request, false)}
              >
                <X />
                {t('hr.requests.reject')}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * «Ажилтны бүртгэл» (ADR-0144, ADR-0145, hr.attendance.view): the one list of the staff — a system
 * user and an employee are one record — with the photo, division, phone, roles and schedule, the
 * pending requests on top for HR; narrowed by a search, the division, the role and «Ажлаас гарсан
 * ажилтнууд», which holds everybody whose account is closed. A row opens the employee's page;
 * «Ажилтан нэмэх» (?new=1) registers one who then signs in by phone and password. «Excel экспорт»
 * downloads the list.
 */
export function StaffPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const setParam = useSetParam();
  const roleLabel = useRoleLabel();
  const canManage = useHasPermission('hr.attendance.manage');
  const staff = useStaff();
  const divisions = useDivisions();
  const pending = usePendingRequests(canManage);
  const downloads = useHrDownloads();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const creating = { open: creatingOpen, setOpen: setCreatingOpen };
  const query = search.get('q') ?? '';
  const divisionParam = search.get('division') ?? '';
  const roleParam = search.get('role') ?? '';
  const showLeft = search.get('left') === '1';

  const rows = useMemo(() => {
    const terms = queryTerms(query);
    return (staff.data ?? [])
      .filter((row) => isEmployeeLeft(row) === showLeft)
      .filter((row) =>
        roleParam === ''
          ? true
          : roleParam === 'none'
            ? row.roles.length === 0
            : row.roles.includes(roleParam),
      )
      .filter((row) =>
        divisionParam === ''
          ? true
          : divisionParam === 'none'
            ? row.divisionId === null
            : String(row.divisionId) === divisionParam,
      )
      .filter(
        (row) =>
          terms.length === 0 ||
          matchesQuery(
            searchKeys(row.fullName, [
              row.phone ?? '',
              row.position ?? '',
              row.divisionName ?? '',
              roleLabel(row.roles),
            ]),
            terms,
          ),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }, [staff.data, query, divisionParam, roleParam, showLeft, roleLabel]);
  const roleOptions = useMemo(
    () => [...new Set((staff.data ?? []).flatMap((row) => row.roles))],
    [staff.data],
  );
  const photos = useMemo(
    () => new Map((staff.data ?? []).map((row) => [row.userId, row.photoUrl])),
    [staff.data],
  );
  const filtered = query !== '' || divisionParam !== '' || roleParam !== '' || showLeft;

  const exportStaff = async () => {
    try {
      saveBlob(await downloads.staff.mutateAsync(), `${t('hr.staff.title')}.xlsx`);
    } catch {
      toast.warning(t('common.retry'));
    }
  };

  return (
    <div>
      <PageHeader
        title={t('hr.staff.title')}
        description={t('hr.staff.description')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              pending={downloads.staff.isPending}
              onClick={() => void exportStaff()}
            >
              <Download />
              {t('hr.staff.export')}
            </Button>
            {canManage ? (
              <Button size="sm" onClick={() => creating.setOpen(true)}>
                <Plus />
                {t('hr.staff.create')}
              </Button>
            ) : null}
          </>
        }
      />
      {canManage && pending.data && pending.data.length > 0 ? (
        <PendingCards requests={pending.data} photos={photos} />
      ) : null}
      <FilterBar
        end={
          staff.data ? (
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('hr.staff.count', { count: rows.length })}
            </span>
          ) : null
        }
      >
        <SearchField
          aria-label={t('hr.staff.search')}
          placeholder={t('hr.staff.search')}
          value={query}
          onChange={(event) => setParam('q', event.target.value || null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('hr.staff.division')}
          value={divisionParam}
          onChange={(event) => setParam('division', event.target.value || null)}
        >
          <option value="">{t('hr.staff.allDivisions')}</option>
          {(divisions.data ?? []).map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
          <option value="none">{t('hr.staff.noDivision')}</option>
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('hr.staff.columns.roles')}
          value={roleParam}
          onChange={(event) => setParam('role', event.target.value || null)}
        >
          <option value="">{t('hr.staff.allRoles')}</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {roleLabel([role])}
            </option>
          ))}
          <option value="none">{t('hr.staff.noRole')}</option>
        </NativeSelect>
        <FilterToggle
          label={t('hr.staff.showLeft')}
          checked={showLeft}
          onCheckedChange={(checked) => setParam('left', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(staff.error)} onRetry={staff.refetch} />
      <ListCard scroll>
        {staff.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('hr.staff.noMatch') : t('hr.staff.empty')}
            icon={Users}
            onClearFilters={
              filtered
                ? () => {
                    setParam('q', null);
                    setParam('division', null);
                    setParam('role', null);
                    setParam('left', null);
                  }
                : undefined
            }
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.staff.columns.employee')}</TableHead>
                <TableHead>{t('hr.staff.columns.division')}</TableHead>
                <TableHead>{t('hr.staff.columns.phone')}</TableHead>
                <TableHead>{t('hr.staff.columns.roles')}</TableHead>
                <TableHead>{t('hr.staff.columns.schedule')}</TableHead>
                <TableHead>
                  {showLeft ? t('hr.staff.left.date') : t('hr.staff.columns.lastLogin')}
                </TableHead>
                <TableHead>{t('hr.staff.columns.status')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.isPending ? <SkeletonRows columns={8} /> : null}
              {rows.map((row) => (
                <LinkRow key={row.userId} to={`/hr/staff/${row.userId}`}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={row.fullName} src={row.photoUrl} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.position ?? t('common.none')}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="truncate">
                    {row.divisionName ?? (
                      <span className="text-muted-foreground">{t('hr.staff.noDivision')}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {row.phone ? (
                      localPhone(row.phone)
                    ) : (
                      <Badge variant="warning">{t('users.noPhone')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="truncate">
                    {row.roles.length > 0 ? (
                      roleLabel(row.roles)
                    ) : (
                      <span className="text-muted-foreground">{t('hr.staff.noRole')}</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate">
                    {row.scheduleName ?? (
                      <span className="text-muted-foreground">{t('hr.companySchedule')}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {showLeft
                      ? (row.leftOn ?? t('common.none'))
                      : row.lastLoginAt
                        ? formatUbDateTime(Date.parse(row.lastLoginAt))
                        : t('common.none')}
                  </TableCell>
                  <TableCell>
                    <StaffStatus staff={row} />
                  </TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {creating.open && canManage ? (
        <StaffCreateDialog
          onClose={() => creating.setOpen(false)}
          onCreated={(userId) => void navigate(`/hr/staff/${userId}`)}
        />
      ) : null}
    </div>
  );
}
