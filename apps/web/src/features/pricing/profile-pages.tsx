import { Archive, Pencil, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
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
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type PriceProfile,
  type PriceProfileVersion,
  usePriceProfile,
  usePriceProfiles,
  usePricingMutations,
} from './api';
import { lastDayOf } from './helpers';
import { profileValuesOf, useProfileSummary } from './price-views';
import { ProfileExample, ProfileValuesDialog, RenameProfileDialog } from './profile-form';

const FILTERS = ['LIVE', 'ARCHIVED'] as const;

/**
 * «Үнэ» → «Үнийн тохиргоо» (ADR-0048 #3): the profiles products take their prices from, with the
 * values in force today and how many products use each. Every user reads them; pricing.manage
 * creates them (`?new=1`) and changes them on their pages.
 */
export function PriceProfilesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.manage');
  const [params, setParams] = useSearchParams();
  const archived = params.get('archived') === '1';
  const profiles = usePriceProfiles(archived);
  const [creating, setCreating] = useCreateParam();
  const rows = profiles.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader
        title={t('pricing.profiles.title')}
        meta={<p className="max-w-3xl">{t('pricing.profiles.intro')}</p>}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('pricing.profiles.new')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SegmentedControl
          options={FILTERS}
          label={(value) => t(`pricing.profiles.filters.${value}`)}
          value={archived ? 'ARCHIVED' : 'LIVE'}
          onChange={(value) =>
            setParams(value === 'ARCHIVED' ? { archived: '1' } : {}, { replace: true })
          }
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(profiles.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.profiles.columns.name')}</TableHead>
              <TableHead className="text-right">{t('pricing.profiles.columns.loose')}</TableHead>
              <TableHead className="text-right">{t('pricing.profiles.columns.retail')}</TableHead>
              <TableHead className="text-right">
                {t('pricing.profiles.columns.retailBulk')}
              </TableHead>
              <TableHead>{t('pricing.profiles.columns.rounding')}</TableHead>
              <TableHead className="text-right">{t('pricing.profiles.columns.products')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((profile) => (
              <ProfileRow key={profile.id} profile={profile} />
            ))}
          </TableBody>
        </Table>
        {!profiles.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={archived ? t('pricing.profiles.emptyArchived') : t('pricing.profiles.empty')}
          />
        ) : null}
        <LoadMore query={profiles} />
      </ListCard>
      {creating && canManage ? (
        <ProfileValuesDialog profile={null} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function ProfileRow({ profile }: { profile: PriceProfile }) {
  const { t } = useTranslation();
  // A profile whose first values start later shows those, marked with their day.
  const upcoming = profile.current ? null : (profile.scheduled[0] ?? null);
  const values = profile.current ?? upcoming;
  const markup = (pct: string) => t('pricing.profiles.markup', { pct: plainDecimal(pct) });
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <LinkRow to={`/pricing/profiles/${profile.id}`}>
      <TableCell className="whitespace-normal">
        <Link
          to={`/pricing/profiles/${profile.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {profile.name}
        </Link>
        {upcoming ? (
          <Badge variant="outline" className="ml-2">
            {t('pricing.profiles.startsOn', { date: upcoming.validFrom })}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-right font-mono">
        {values ? markup(values.looseMarkupPct) : none}
      </TableCell>
      <TableCell className="text-right font-mono">
        {values ? markup(values.retailMarkupPct) : none}
      </TableCell>
      <TableCell className="text-right font-mono">
        {values?.retailBulkMarkupPct && values.retailBulkMinQty
          ? t('pricing.profiles.bulkCell', {
              pct: plainDecimal(values.retailBulkMarkupPct),
              qty: plainDecimal(values.retailBulkMinQty),
            })
          : none}
      </TableCell>
      <TableCell>{values ? t(`pricing.roundings.${values.rounding}`) : none}</TableCell>
      <TableCell className="text-right font-mono">{profile.productsToday}</TableCell>
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

function ProfileDetail({ profile }: { profile: PriceProfile }) {
  const { t } = useTranslation();
  const archived = profile.archivedAt !== null;
  const canManage = useHasPermission('pricing.manage') && !archived;
  const mutations = usePricingMutations();
  const archiving = useAction();
  const summary = useProfileSummary();
  const [open, setOpen] = useState<'values' | 'rename' | 'archive' | null>(null);
  // Latest first: the planned values, today's, then the earlier ones.
  const versions: { version: PriceProfileVersion; status: VersionStatus }[] = [
    ...[...profile.scheduled].reverse().map((version) => ({
      version,
      status: 'SCHEDULED' as const,
    })),
    ...(profile.current ? [{ version: profile.current, status: 'CURRENT' as const }] : []),
    ...profile.history.map((version) => ({ version, status: 'PAST' as const })),
  ];

  const archive = async () => {
    const ok = await archiving.run(() => mutations.archiveProfile.mutateAsync(profile.id));
    if (!ok) return;
    setOpen(null);
    toast.success(t('pricing.profiles.archivedToast'));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={profile.name}
        meta={
          <>
            {archived ? <Badge variant="secondary">{t('pricing.profiles.archived')}</Badge> : null}
            <span>{t('pricing.profiles.productsCount', { count: profile.productsToday })}</span>
          </>
        }
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setOpen('rename')}>
                <Pencil />
                {t('pricing.profiles.rename')}
              </Button>
              <Button variant="outline" onClick={() => setOpen('archive')}>
                <Archive />
                {t('pricing.profiles.archive')}
              </Button>
              <Button onClick={() => setOpen('values')}>
                <Plus />
                {t('pricing.profiles.setValues')}
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card role="region" aria-label={t('pricing.profiles.current')}>
          <CardHeader>
            <CardTitle>{t('pricing.profiles.current')}</CardTitle>
            <CardDescription>
              {profile.current
                ? t('pricing.profiles.currentFrom', { date: profile.current.validFrom })
                : t('pricing.profiles.noCurrent')}
            </CardDescription>
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
                    <TableCell className="whitespace-normal">{summary(version)}</TableCell>
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
      {open === 'values' && canManage ? (
        <ProfileValuesDialog profile={profile} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'rename' && canManage ? (
        <RenameProfileDialog profile={profile} onClose={() => setOpen(null)} />
      ) : null}
      <ConfirmDialog
        open={open === 'archive'}
        title={t('pricing.profiles.archiveTitle', { name: profile.name })}
        description={t('pricing.profiles.archiveDescription')}
        confirmLabel={t('pricing.profiles.archive')}
        variant="destructive"
        pending={mutations.archiveProfile.isPending}
        problem={archiving.problem}
        onConfirm={() => void archive()}
        onClose={() => {
          archiving.clear();
          setOpen(null);
        }}
      />
    </div>
  );
}
