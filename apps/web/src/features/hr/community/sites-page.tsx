import { parseCoordinates } from '@tugeel/shared/geo';
import { HR_LIMITS } from '@tugeel/shared/hr';
import { Archive, ArchiveRestore, MapPin, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, FilterToggle, RowAction, SearchField } from '@/components/list';
import { GeoMap, type MapPoint } from '@/components/map/geo-map';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useBranches } from '@/features/identity/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import {
  type HrEmployee,
  useHrEmployees,
  useHrMutations,
  useWorkSites,
  type WorkSite,
  type WorkSiteRequest,
} from '../api';

const GPS_PROBLEMS = {
  EMPTY: 'validation.required',
  SHORT_LINK: 'validation.gpsShortLink',
  FORMAT: 'validation.gpsFormat',
  OUTSIDE: 'validation.gpsOutside',
} as const;
const RADIUS_RANGE = { min: HR_LIMITS.minRadiusM, max: HR_LIMITS.maxRadiusM };
const INTEGER = /^\d+$/;

const pointOfSite = (site: WorkSite): MapPoint => ({
  id: String(site.id),
  lat: Number.parseFloat(site.lat),
  lng: Number.parseFloat(site.lng),
  label: site.name,
  radiusM: site.radiusM,
});

/** Who punches at a site: those it is named for, plus those with no site (any place will do). */
function siteStaff(employees: readonly HrEmployee[], siteId: number) {
  const working = employees.filter((row) => row.status === 'ACTIVE' && row.tracked);
  return {
    named: working.filter((row) => row.siteIds.includes(siteId)).length,
    anywhere: working.filter((row) => row.siteIds.length === 0).length,
  };
}

/** The site's form beside its map: a click on the map sets the coordinates. */
function SiteMapDialog({ site, onClose }: { site: WorkSite | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { createSite, updateSite } = useHrMutations();
  const branches = useBranches();
  const action = useAction();
  const [name, setName] = useState(site?.name ?? '');
  const [coordinates, setCoordinates] = useState(site ? `${site.lat}, ${site.lng}` : '');
  const [radius, setRadius] = useState(String(site?.radiusM ?? HR_LIMITS.defaultRadiusM));
  const [branchId, setBranchId] = useState(site?.branchId == null ? '' : String(site.branchId));
  const [errors, setErrors] = useState<{
    name?: 'validation.required';
    coordinates?: (typeof GPS_PROBLEMS)[keyof typeof GPS_PROBLEMS];
    radius?: boolean;
  }>({});
  const parsed = parseCoordinates(coordinates);
  const radiusText = radius.trim();
  const radiusOk =
    INTEGER.test(radiusText) &&
    Number(radiusText) >= RADIUS_RANGE.min &&
    Number(radiusText) <= RADIUS_RANGE.max;
  const points: MapPoint[] = parsed.ok
    ? [
        {
          id: 'draft',
          lat: Number.parseFloat(parsed.value.lat),
          lng: Number.parseFloat(parsed.value.lng),
          label: name.trim() || t('hr.community.sites.newPoint'),
          radiusM: radiusOk ? Number(radiusText) : null,
        },
      ]
    : [];
  const pending = createSite.isPending || updateSite.isPending;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const next: typeof errors = {};
    if (trimmed === '') next.name = 'validation.required';
    if (!parsed.ok) next.coordinates = GPS_PROBLEMS[parsed.problem];
    if (!radiusOk) next.radius = true;
    setErrors(next);
    if (next.name || next.radius || !parsed.ok) return;
    const body: WorkSiteRequest = {
      name: trimmed,
      lat: parsed.value.lat,
      lng: parsed.value.lng,
      radiusM: Number(radiusText),
      branchId: branchId === '' ? null : Number(branchId),
    };
    const ok = await action.run(() =>
      site ? updateSite.mutateAsync({ id: site.id, body }) : createSite.mutateAsync(body),
    );
    if (ok) {
      toast.success(t(site ? 'hr.setup.sites.saved' : 'hr.setup.sites.created'));
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <DialogHeader>
          <DialogTitle>
            {site ? t('hr.community.sites.edit') : t('hr.community.sites.create')}
          </DialogTitle>
          <DialogDescription>{t('hr.community.sites.mapHint')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <FormField label={t('hr.setup.sites.name')} htmlFor="site-name" error={errors.name}>
                <Input
                  id="site-name"
                  autoComplete="off"
                  maxLength={HR_LIMITS.maxSiteName}
                  value={name}
                  onChange={(event) => {
                    setErrors((prev) => ({ ...prev, name: undefined }));
                    setName(event.target.value);
                  }}
                />
              </FormField>
              <FormField
                label={t('hr.setup.sites.coordinates')}
                htmlFor="site-coordinates"
                hint={t('hr.setup.sites.coordinatesHint')}
                error={errors.coordinates}
              >
                <Input
                  id="site-coordinates"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  value={coordinates}
                  onChange={(event) => {
                    setErrors((prev) => ({ ...prev, coordinates: undefined }));
                    setCoordinates(event.target.value);
                  }}
                />
              </FormField>
              <FormField
                label={t('hr.setup.sites.radius')}
                htmlFor="site-radius"
                hint={t('hr.setup.sites.radiusHint', RADIUS_RANGE)}
              >
                <Input
                  id="site-radius"
                  type="number"
                  inputMode="numeric"
                  min={RADIUS_RANGE.min}
                  max={RADIUS_RANGE.max}
                  className="font-mono"
                  value={radius}
                  aria-invalid={errors.radius ? true : undefined}
                  onChange={(event) => {
                    setErrors((prev) => ({ ...prev, radius: undefined }));
                    setRadius(event.target.value);
                  }}
                />
                {errors.radius ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t('validation.integerRange', RADIUS_RANGE)}
                  </p>
                ) : null}
              </FormField>
              <FormField label={t('hr.setup.sites.branch')} htmlFor="site-branch">
                <NativeSelect
                  id="site-branch"
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                >
                  <option value="">{t('hr.setup.sites.noBranch')}</option>
                  {(branches.data ?? []).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
            <GeoMap
              points={points}
              label={t('hr.community.sites.pickLabel')}
              className="h-80 lg:h-full"
              onPick={(position) => {
                setErrors((prev) => ({ ...prev, coordinates: undefined }));
                setCoordinates(`${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`);
              }}
            />
          </div>
          <DialogFormFooter
            pending={pending}
            onCancel={onClose}
            submitLabel={site ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Ажлын байршил» (ADR-0146, the owner's picture): the sites on the left, the big map on the right.
 * The same data as the setup page's list; a punch counts inside a site's radius.
 */
export function SitesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const [showArchived, setShowArchived] = useState(false);
  const sites = useWorkSites(showArchived);
  const employees = useHrEmployees();
  const { archiveSite } = useHrMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<WorkSite | null>(null);
  const [archiving, setArchiving] = useState<WorkSite | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (sites.data ?? []).filter(
      (site) => words === '' || site.name.toLowerCase().includes(words),
    );
  }, [sites.data, search]);
  const points = useMemo(
    () => rows.filter((site) => site.archivedAt === null).map(pointOfSite),
    [rows],
  );
  const staffRows = employees.data ?? [];
  const staffLine = (site: WorkSite) => {
    const { named, anywhere } = siteStaff(staffRows, site.id);
    if (named === 0) return t('hr.community.sites.everybody');
    return anywhere > 0
      ? t('hr.community.sites.staffPlusAll', { count: named })
      : t('hr.community.sites.staff', { count: named });
  };
  const restore = async (site: WorkSite) => {
    const ok = await action.run(() => archiveSite.mutateAsync({ id: site.id, archived: false }));
    if (ok) toast.success(t('hr.setup.sites.restoredToast'));
  };
  const archive = async () => {
    if (!archiving) return;
    const ok = await action.run(() =>
      archiveSite.mutateAsync({ id: archiving.id, archived: true }),
    );
    if (ok) {
      toast.success(t('hr.setup.sites.archivedToast'));
      setArchiving(null);
    }
  };
  return (
    <div>
      <PageHeader
        title={t('nav.hrSites')}
        description={t('hr.community.sites.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('hr.community.sites.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert
        problem={action.problem ?? problemFromError(sites.error)}
        onRetry={sites.refetch}
      />
      <div className="grid items-stretch gap-4 lg:h-[calc(100dvh-11rem)] lg:min-h-[28rem] lg:grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Card className="min-h-0 gap-3 pb-0">
          <div className="flex flex-col gap-2 px-4">
            <SearchField
              className="sm:w-full"
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div>
              <FilterToggle
                label={t('hr.setup.sites.showArchived')}
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
            </div>
          </div>
          {sites.data && rows.length === 0 ? (
            <EmptyState
              title={search ? t('hr.community.noMatch') : t('hr.setup.sites.empty')}
              icon={MapPin}
              onClearFilters={search ? () => setSearch('') : undefined}
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto border-t border-border">
              {rows.map((site) => {
                const id = String(site.id);
                const archived = site.archivedAt !== null;
                return (
                  <li
                    key={site.id}
                    className={cn(
                      'flex items-center gap-1 pr-2 transition-colors hover:bg-accent',
                      focusId === id && 'bg-secondary hover:bg-secondary',
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={focusId === id}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2.5 text-left outline-none focus-visible:bg-accent"
                      onClick={() => setFocusId(id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
                        <span className="truncate font-medium">{site.name}</span>
                        {archived ? (
                          <Badge variant="outline">{t('hr.setup.sites.archived')}</Badge>
                        ) : null}
                      </span>
                      <span className="pl-6 text-[0.8125rem] text-muted-foreground">
                        {t('hr.community.sites.radiusLine', { radius: site.radiusM })}
                        {' · '}
                        {staffLine(site)}
                      </span>
                    </button>
                    {canManage ? (
                      archived ? (
                        <RowAction
                          label={t('hr.setup.sites.restoreFor', { name: site.name })}
                          icon={ArchiveRestore}
                          onClick={() => void restore(site)}
                        />
                      ) : (
                        <>
                          <RowAction
                            label={t('hr.setup.sites.editFor', { name: site.name })}
                            icon={Pencil}
                            onClick={() => setEditing(site)}
                          />
                          <RowAction
                            label={t('hr.setup.sites.archiveFor', { name: site.name })}
                            icon={Archive}
                            destructive
                            onClick={() => setArchiving(site)}
                          />
                        </>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <GeoMap
          points={points}
          label={t('hr.community.sites.mapLabel')}
          focusId={focusId}
          className="min-h-80 bg-card"
        />
      </div>
      {canManage && creating ? (
        <SiteMapDialog site={null} onClose={() => setCreating(false)} />
      ) : null}
      {canManage && editing ? (
        <SiteMapDialog key={editing.id} site={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={archiving !== null}
        title={t('hr.community.sites.archiveTitle')}
        description={t('hr.community.sites.archiveDescription', { name: archiving?.name ?? '' })}
        confirmLabel={t('hr.setup.sites.archive')}
        pending={archiveSite.isPending}
        problem={action.problem}
        onConfirm={() => void archive()}
        onClose={() => {
          action.clear();
          setArchiving(null);
        }}
      />
    </div>
  );
}
