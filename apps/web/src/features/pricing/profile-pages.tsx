import { PRICE_ROUNDINGS } from '@tugeel/shared/pricing';
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  SlidersHorizontal,
  Tags,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FilterChoices, FilterSection } from '@/components/filter-panel';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  RowAction,
  RowActionSpacer,
  RowActions,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type PriceProfile,
  type PriceProfileVersion,
  type ProfileFilter,
  usePriceProfile,
  usePriceProfiles,
  usePricingMutations,
} from './api';
import { lastDayOf } from './helpers';
import { profileValuesOf, useProfileSummaryParts } from './price-views';
import { ProfileExample, ProfileProductsLink } from './profile-form';

const STATUSES = ['ACTIVE', 'SCHEDULED', 'ARCHIVED'] as const;
const BULKS = ['WITH', 'WITHOUT'] as const;
const USES = ['USED', 'UNUSED'] as const;

const STATUS_VARIANT: Record<PriceProfile['status'], 'success' | 'default' | 'secondary'> = {
  ACTIVE: 'success',
  SCHEDULED: 'default',
  ARCHIVED: 'secondary',
};

/** The list's columns (ADR-0119): the markups and the rounding read as one, each whole. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 2, min: 10 },
  { key: 'status', kind: 'status', width: 6.5 },
  { key: 'values', kind: 'text', weight: 4, min: 13 },
  { key: 'products', kind: 'count', width: 5.75 },
  { key: 'createdBy', kind: 'text', weight: 1, min: 5 },
  { key: 'createdAt', kind: 'date', width: 7 },
  { key: 'updatedAt', kind: 'date', width: 7 },
  { key: 'actions', kind: 'actions', actions: 3 },
  { key: 'chevron', kind: 'chevron' },
];

const inList = <T extends string>(options: readonly T[], value: string | null): T | undefined =>
  options.find((option) => option === value);

/**
 * «Үнэ» → «Үнийн тохиргоо» (ADR-0048 #3, ADR-0160): filters on the left and the profiles products
 * take their prices from, with the values in force today, how many products use each, who made it
 * and when, and its row's edit, archive and delete. Every user reads them; pricing.manage changes.
 */
export function PriceProfilesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.manage');
  const [params, setParams] = useSearchParams();
  const status = inList(STATUSES, params.get('status'));
  const rounding = inList(PRICE_ROUNDINGS, params.get('rounding'));
  const bulk = inList(BULKS, params.get('bulk'));
  const used = inList(USES, params.get('used'));
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const filter: ProfileFilter = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(rounding ? { rounding } : {}),
    ...(bulk ? { bulk } : {}),
    ...(used ? { used } : {}),
  };
  const profiles = usePriceProfiles(filter);
  const rows = profiles.data?.pages.flatMap((page) => page.data) ?? [];
  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const filtered = Object.keys(filter).length > 0;
  const clear = () => {
    setSearch('');
    setParams({}, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('pricing.profiles.title')}
        description={t('pricing.profiles.intro')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/pricing/profiles/new">
                <Plus />
                {t('pricing.profiles.new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex items-start gap-3">
        <aside
          aria-label={t('pricing.profiles.panel.label')}
          className="hidden w-52 shrink-0 lg:block"
        >
          <ListCard scroll beside>
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
              <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{t('pricing.profiles.panel.title')}</span>
              {filtered ? (
                <Button type="button" size="xs" variant="ghost" onClick={clear}>
                  {t('pricing.profiles.panel.clear')}
                </Button>
              ) : null}
            </div>
            <FilterSection
              title={t('pricing.profiles.columns.status')}
              defaultOpen
              active={!!status}
            >
              <FilterChoices
                options={STATUSES}
                label={(value) => t(`pricing.profiles.statuses.${value}`)}
                value={status ?? null}
                onChange={(value) => setParam('status', value)}
              />
            </FilterSection>
            <FilterSection
              title={t('pricing.profiles.fields.rounding')}
              defaultOpen
              active={!!rounding}
            >
              <FilterChoices
                options={PRICE_ROUNDINGS}
                label={(value) => t(`pricing.roundings.${value}`)}
                value={rounding ?? null}
                onChange={(value) => setParam('rounding', value)}
              />
            </FilterSection>
            <FilterSection title={t('pricing.profiles.panel.bulk')} active={!!bulk}>
              <FilterChoices
                options={BULKS}
                label={(value) => t(`pricing.profiles.panel.bulks.${value}`)}
                value={bulk ?? null}
                onChange={(value) => setParam('bulk', value)}
              />
            </FilterSection>
            <FilterSection title={t('pricing.profiles.panel.used')} active={!!used}>
              <FilterChoices
                options={USES}
                label={(value) => t(`pricing.profiles.panel.uses.${value}`)}
                value={used ?? null}
                onChange={(value) => setParam('used', value)}
              />
            </FilterSection>
          </ListCard>
        </aside>
        <div className="min-w-0 flex-1">
          <FilterBar>
            <SearchField
              className="sm:w-60"
              aria-label={t('common.search')}
              placeholder={t('pricing.profiles.search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setParam('q', event.target.value.trim() || null);
              }}
            />
          </FilterBar>
          <ProblemAlert problem={problemFromError(profiles.error)} onRetry={profiles.refetch} />
          <ProfileTable
            rows={rows}
            pending={profiles.isPending}
            canManage={canManage}
            filtered={filtered}
            archivedOnly={status === 'ARCHIVED'}
            onClear={clear}
          >
            <LoadMore query={profiles} />
          </ProfileTable>
        </div>
      </div>
    </div>
  );
}

type RowAct = { kind: 'archive' | 'restore' | 'delete'; profile: PriceProfile };

function ProfileTable(props: {
  rows: readonly PriceProfile[];
  pending: boolean;
  canManage: boolean;
  filtered: boolean;
  archivedOnly: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const mutations = usePricingMutations();
  const action = useAction();
  const [acting, setActing] = useState<RowAct | null>(null);

  const run = async () => {
    if (!acting) return;
    const { kind, profile } = acting;
    const ok = await action.run(() => {
      if (kind === 'delete') return mutations.deleteProfile.mutateAsync(profile.id);
      if (kind === 'archive') return mutations.archiveProfile.mutateAsync(profile.id);
      return mutations.restoreProfile.mutateAsync(profile.id);
    });
    if (!ok) return;
    setActing(null);
    toast.success(t(`pricing.profiles.done.${kind}`));
  };

  return (
    <>
      <ListCard scroll beside>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.profiles.columns.name')}</TableHead>
              <TableHead>{t('pricing.profiles.columns.status')}</TableHead>
              <TableHead>{t('pricing.profiles.columns.values')}</TableHead>
              <TableHead className="text-right">{t('pricing.profiles.columns.products')}</TableHead>
              <TableHead>{t('pricing.profiles.columns.createdBy')}</TableHead>
              <TableHead>{t('pricing.profiles.columns.createdAt')}</TableHead>
              <TableHead>{t('pricing.profiles.columns.updatedAt')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('pricing.profiles.columns.actions')}</span>
              </TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.pending ? <SkeletonRows columns={9} /> : null}
            {props.rows.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                canManage={props.canManage}
                onAct={(kind) => setActing({ kind, profile })}
              />
            ))}
          </TableBody>
        </ListTable>
        {!props.pending && props.rows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={
              props.archivedOnly ? t('pricing.profiles.emptyArchived') : t('pricing.profiles.empty')
            }
            {...(props.filtered ? { onClearFilters: props.onClear } : {})}
          />
        ) : null}
        {props.children}
      </ListCard>
      <ConfirmDialog
        open={acting !== null}
        title={t(`pricing.profiles.confirm.${acting?.kind ?? 'archive'}.title`, {
          name: acting?.profile.name ?? '',
        })}
        description={t(`pricing.profiles.confirm.${acting?.kind ?? 'archive'}.description`)}
        confirmLabel={t(`pricing.profiles.${acting?.kind ?? 'archive'}`)}
        {...(acting?.kind === 'delete' ? { variant: 'destructive' as const } : {})}
        pending={
          mutations.deleteProfile.isPending ||
          mutations.archiveProfile.isPending ||
          mutations.restoreProfile.isPending
        }
        problem={action.problem}
        onConfirm={() => void run()}
        onClose={() => {
          action.clear();
          setActing(null);
        }}
      />
    </>
  );
}

function ProfileRow(props: {
  profile: PriceProfile;
  canManage: boolean;
  onAct: (kind: RowAct['kind']) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summary = useProfileSummaryParts();
  const { profile } = props;
  // A profile whose first values start later shows those, marked with their day.
  const upcoming = profile.current ? null : (profile.scheduled[0] ?? null);
  const values = profile.current ?? upcoming;
  const archived = profile.status === 'ARCHIVED';
  return (
    <LinkRow to={`/pricing/profiles/${profile.id}`}>
      <TruncateCell text={profile.name}>
        <Link
          to={`/pricing/profiles/${profile.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {profile.name}
        </Link>
      </TruncateCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[profile.status]}>
          {t(`pricing.profiles.statuses.${profile.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-normal">
        {/* Each value whole; on a narrow window they wrap between themselves. */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {upcoming ? (
            <span className="text-muted-foreground">
              {t('pricing.profiles.startsOn', { date: upcoming.validFrom })}
            </span>
          ) : null}
          {values ? (
            summary(values).map((part) => (
              <span key={part} className="whitespace-nowrap">
                {part}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">{t('common.none')}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono">
        {profile.productsToday > 0 ? (
          <Link
            to={`/catalog/products?profile=${profile.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-link underline-offset-4 hover:underline"
          >
            {formatCount(profile.productsToday)}
          </Link>
        ) : (
          formatCount(profile.productsToday)
        )}
      </TableCell>
      <TruncateCell text={profile.createdByName ?? t('common.none')} />
      {/* The day in the row, the minute on hover. */}
      <TableCell
        className="font-mono text-xs"
        title={formatUbDateTime(Date.parse(profile.createdAt))}
      >
        {formatUbDateTime(Date.parse(profile.createdAt)).slice(0, 10)}
      </TableCell>
      <TableCell
        className="font-mono text-xs"
        title={formatUbDateTime(Date.parse(profile.updatedAt))}
      >
        {formatUbDateTime(Date.parse(profile.updatedAt)).slice(0, 10)}
      </TableCell>
      {props.canManage ? (
        <RowActions>
          {archived ? (
            <RowActionSpacer />
          ) : (
            <RowAction
              label={t('common.edit')}
              icon={Pencil}
              onClick={() => void navigate(`/pricing/profiles/${profile.id}/edit`)}
            />
          )}
          {archived ? (
            <RowAction
              label={t('pricing.profiles.restore')}
              icon={ArchiveRestore}
              onClick={() => props.onAct('restore')}
            />
          ) : (
            <RowAction
              label={t('pricing.profiles.archive')}
              icon={Archive}
              onClick={() => props.onAct('archive')}
            />
          )}
          <RowAction
            label={t('pricing.profiles.delete')}
            icon={Trash2}
            destructive
            onClick={() => props.onAct('delete')}
          />
        </RowActions>
      ) : (
        <TableCell />
      )}
    </LinkRow>
  );
}

/** One profile: today's values worked out on an example, the planned and earlier values. */
export function PriceProfilePage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const profile = usePriceProfile(id);
  const loadProblem = problemFromError(profile.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!profile.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return <ProfileDetail profile={profile.data} />;
}

type VersionStatus = 'SCHEDULED' | 'CURRENT' | 'PAST';
type DetailAct = 'archive' | 'restore' | 'delete';

function ProfileDetail({ profile }: { profile: PriceProfile }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const archived = profile.status === 'ARCHIVED';
  const canManage = useHasPermission('pricing.manage');
  const mutations = usePricingMutations();
  const action = useAction();
  const summary = useProfileSummaryParts();
  const [open, setOpen] = useState<DetailAct | null>(null);
  // Latest first: the planned values, today's, then the earlier ones.
  const versions: { version: PriceProfileVersion; status: VersionStatus }[] = [
    ...[...profile.scheduled].reverse().map((version) => ({
      version,
      status: 'SCHEDULED' as const,
    })),
    ...(profile.current ? [{ version: profile.current, status: 'CURRENT' as const }] : []),
    ...profile.history.map((version) => ({ version, status: 'PAST' as const })),
  ];

  const run = async () => {
    if (!open) return;
    const kind = open;
    const ok = await action.run(() => {
      if (kind === 'delete') return mutations.deleteProfile.mutateAsync(profile.id);
      if (kind === 'archive') return mutations.archiveProfile.mutateAsync(profile.id);
      return mutations.restoreProfile.mutateAsync(profile.id);
    });
    if (!ok) return;
    setOpen(null);
    toast.success(t(`pricing.profiles.done.${kind}`));
    if (kind === 'delete') void navigate('/pricing/profiles');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={profile.name}
        meta={
          <>
            <Badge variant={STATUS_VARIANT[profile.status]}>
              {t(`pricing.profiles.statuses.${profile.status}`)}
            </Badge>
            <span>
              {t('pricing.profiles.productsCount', { count: formatCount(profile.productsToday) })}
            </span>
            <span>
              {t('pricing.profiles.madeBy', {
                name: profile.createdByName ?? t('common.none'),
                date: formatUbDateTime(Date.parse(profile.createdAt)).slice(0, 10),
              })}
            </span>
            <span>
              {t('pricing.profiles.changedOn', {
                date: formatUbDateTime(Date.parse(profile.updatedAt)).slice(0, 10),
              })}
            </span>
          </>
        }
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setOpen(archived ? 'restore' : 'archive')}>
                {archived ? <ArchiveRestore /> : <Archive />}
                {t(archived ? 'pricing.profiles.restore' : 'pricing.profiles.archive')}
              </Button>
              <Button variant="destructive" onClick={() => setOpen('delete')}>
                <Trash2 />
                {t('pricing.profiles.delete')}
              </Button>
              {archived ? null : (
                <Button variant="secondary" asChild>
                  <Link to={`/pricing/profiles/${profile.id}/edit`}>
                    <Pencil />
                    {t('common.edit')}
                  </Link>
                </Button>
              )}
            </>
          ) : null
        }
      />
      <ProblemAlert problem={open ? null : action.problem} />
      {/* The history takes the wider share: dates on one line, one price a line. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card role="region" aria-label={t('pricing.profiles.current')}>
          <CardHeader>
            <CardTitle>{t('pricing.profiles.current')}</CardTitle>
            <CardDescription>
              {profile.current
                ? t('pricing.profiles.currentFrom', { date: profile.current.validFrom })
                : t('pricing.profiles.noCurrent')}
            </CardDescription>
            <ProfileProductsLink profile={profile} />
          </CardHeader>
          {profile.current ? (
            <CardContent>
              <ProfileExample values={profileValuesOf(profile.current)} />
            </CardContent>
          ) : null}
        </Card>
        <Card role="region" aria-label={t('pricing.profiles.versions')}>
          <CardHeader>
            <CardTitle>{t('pricing.profiles.versions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pricing.profiles.versionColumns.period')}</TableHead>
                  <TableHead>{t('pricing.profiles.versionColumns.values')}</TableHead>
                  <TableHead>{t('pricing.profiles.versionColumns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map(({ version, status }) => (
                  <TableRow key={version.id}>
                    <TableCell className="font-mono">
                      {version.validTo
                        ? t('pricing.profiles.periodClosed', {
                            from: version.validFrom,
                            to: lastDayOf(version.validTo),
                          })
                        : t('pricing.profiles.periodOpen', { from: version.validFrom })}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {/* One price a line: a half-width card never splits a list mid-line. */}
                      <div className="flex flex-col">
                        {summary(version).map((part) => (
                          <span key={part}>{part}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          status === 'CURRENT'
                            ? 'success'
                            : status === 'SCHEDULED'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {t(`pricing.profiles.status.${status}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={open !== null}
        title={t(`pricing.profiles.confirm.${open ?? 'archive'}.title`, { name: profile.name })}
        description={t(`pricing.profiles.confirm.${open ?? 'archive'}.description`)}
        confirmLabel={t(`pricing.profiles.${open ?? 'archive'}`)}
        {...(open === 'delete' ? { variant: 'destructive' as const } : {})}
        pending={
          mutations.deleteProfile.isPending ||
          mutations.archiveProfile.isPending ||
          mutations.restoreProfile.isPending
        }
        problem={action.problem}
        onConfirm={() => void run()}
        onClose={() => {
          action.clear();
          setOpen(null);
        }}
      />
    </div>
  );
}
