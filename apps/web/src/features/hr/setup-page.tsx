import { parseCoordinates, mapsUrl } from '@tugeel/shared/geo';
import { HR_LIMITS, TIME_PATTERN } from '@tugeel/shared/hr';
import { Archive, ArchiveRestore, MapPinned, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField, FormFooter, FormRow, FormSection } from '@/components/form';
import {
  EmptyState,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranches } from '@/features/identity/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type HrEmployee,
  type HrSchedule,
  type HrScheduleRequest,
  useHrEmployees,
  useHrMutations,
  useHrSchedule,
  useWorkSites,
  type WorkSite,
  type WorkSiteRequest,
} from './api';
import { useRoleLabel, useWorkdaysText } from './hr-helpers';
import { Avatar, WeekdayChecks } from './hr-kit';

const SITE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 10 },
  { key: 'coordinates', kind: 'code', width: 12 },
  { key: 'radius', kind: 'count', width: 5 },
  { key: 'branch', kind: 'text', weight: 2, min: 7 },
  { key: 'actions', kind: 'actions', actions: 2 },
];

const EMPLOYEE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'tracked', kind: 'icon', width: 4 },
  { key: 'sites', kind: 'text', weight: 2, min: 8 },
  { key: 'hours', kind: 'text', weight: 2, min: 8 },
  { key: 'actions', kind: 'actions', actions: 1 },
];

const GPS_PROBLEMS = {
  EMPTY: 'validation.required',
  SHORT_LINK: 'validation.gpsShortLink',
  FORMAT: 'validation.gpsFormat',
  OUTSIDE: 'validation.gpsOutside',
} as const;

const RADIUS_RANGE = { min: HR_LIMITS.minRadiusM, max: HR_LIMITS.maxRadiusM };
const INTEGER = /^\d+$/;

/** A field's message that carries parameters (the radius range), outside `FieldError`'s keys. */
function RangeError({ id, show }: { id: string; show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {t('validation.integerRange', RADIUS_RANGE)}
    </p>
  );
}

/* ------------------------------------------------------------------ sites */

/** «Шинэ байр» / «Байр засах»: the name, a pasted coordinates pair or Maps link, the radius, the branch. */
function SiteDialog(props: { open: boolean; onClose: () => void; site: WorkSite | null }) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {t(props.site ? 'hr.setup.sites.edit' : 'hr.setup.sites.create')}
          </DialogTitle>
        </DialogHeader>
        <SiteForm site={props.site} onClose={props.onClose} />
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's form; mounted while the dialog is open, so it starts from the site each time. */
function SiteForm({ site, onClose }: { site: WorkSite | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { createSite, updateSite } = useHrMutations();
  const branches = useBranches();
  const action = useAction();
  const [name, setName] = useState(site?.name ?? '');
  const [coordinates, setCoordinates] = useState(site ? `${site.lat}, ${site.lng}` : '');
  const [radius, setRadius] = useState(String(site?.radiusM ?? HR_LIMITS.defaultRadiusM));
  const [branchId, setBranchId] = useState(site?.branchId == null ? '' : String(site.branchId));
  const [errors, setErrors] = useState<{
    name?: 'validation.required' | 'validation.tooLong';
    coordinates?: (typeof GPS_PROBLEMS)[keyof typeof GPS_PROBLEMS];
    radius?: boolean;
  }>({});

  const pending = createSite.isPending || updateSite.isPending;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    const trimmed = name.trim();
    if (trimmed === '') next.name = 'validation.required';
    else if ([...trimmed].length > HR_LIMITS.maxSiteName) next.name = 'validation.tooLong';
    const parsed = parseCoordinates(coordinates);
    if (!parsed.ok) next.coordinates = GPS_PROBLEMS[parsed.problem];
    const radiusText = radius.trim();
    const radiusOk =
      INTEGER.test(radiusText) &&
      Number(radiusText) >= RADIUS_RANGE.min &&
      Number(radiusText) <= RADIUS_RANGE.max;
    if (!radiusOk) next.radius = true;
    setErrors(next);
    if (next.name || next.coordinates || next.radius || !parsed.ok) return;
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
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
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
          className="font-mono sm:w-32"
          value={radius}
          aria-invalid={errors.radius ? true : undefined}
          aria-describedby={errors.radius ? 'site-radius-range' : undefined}
          onChange={(event) => {
            setErrors((prev) => ({ ...prev, radius: undefined }));
            setRadius(event.target.value);
          }}
        />
        <RangeError id="site-radius-range" show={errors.radius === true} />
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
      <DialogFormFooter
        pending={pending}
        onCancel={onClose}
        submitLabel={site ? t('common.save') : t('common.create')}
      />
    </form>
  );
}

function SitesCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const sites = useWorkSites(showArchived);
  const { archiveSite } = useHrMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<WorkSite | null>(null);
  const toggleArchived = async (site: WorkSite) => {
    const archived = site.archivedAt === null;
    const ok = await action.run(() => archiveSite.mutateAsync({ id: site.id, archived }));
    if (ok)
      toast.success(t(archived ? 'hr.setup.sites.archivedToast' : 'hr.setup.sites.restoredToast'));
  };
  return (
    <Card role="region" aria-label={t('hr.setup.sites.title')}>
      <CardHeader>
        <CardTitle>{t('hr.setup.sites.title')}</CardTitle>
        <CardDescription>{t('hr.setup.sites.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterToggle
            label={t('hr.setup.sites.showArchived')}
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          {canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('hr.setup.sites.create')}
            </Button>
          ) : null}
        </div>
        <ProblemAlert
          problem={action.problem ?? problemFromError(sites.error)}
          onRetry={sites.refetch}
        />
        <ListCard>
          {sites.data && sites.data.length === 0 ? (
            <EmptyState title={t('hr.setup.sites.empty')} icon={MapPinned} />
          ) : (
            <ListTable columns={SITE_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.setup.sites.name')}</TableHead>
                  <TableHead>{t('hr.setup.sites.coordinates')}</TableHead>
                  <TableHead className="text-right">{t('hr.setup.sites.radius')}</TableHead>
                  <TableHead>{t('hr.setup.sites.branch')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.isPending ? <SkeletonRows columns={5} /> : null}
                {(sites.data ?? []).map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate">{site.name}</span>
                        {site.archivedAt ? (
                          <Badge variant="outline">{t('hr.setup.sites.archived')}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      <a
                        className="text-link underline-offset-2 hover:underline"
                        href={mapsUrl({ lat: site.lat, lng: site.lng })}
                        target="_blank"
                        rel="noreferrer"
                        title={t('hr.setup.sites.map')}
                      >
                        {`${site.lat}, ${site.lng}`}
                      </a>
                    </TableCell>
                    <TableCell className="text-right font-mono">{site.radiusM}</TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {site.branchName ?? t('common.none')}
                    </TableCell>
                    <RowActions>
                      {canManage ? (
                        <>
                          <RowAction
                            label={t('hr.setup.sites.editFor', { name: site.name })}
                            icon={Pencil}
                            onClick={() => setEditing(site)}
                          />
                          <RowAction
                            label={t(
                              site.archivedAt
                                ? 'hr.setup.sites.restoreFor'
                                : 'hr.setup.sites.archiveFor',
                              {
                                name: site.name,
                              },
                            )}
                            icon={site.archivedAt ? ArchiveRestore : Archive}
                            destructive={site.archivedAt === null}
                            disabled={archiveSite.isPending}
                            onClick={() => void toggleArchived(site)}
                          />
                        </>
                      ) : null}
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </ListTable>
          )}
        </ListCard>
        {canManage ? (
          <SiteDialog
            open={creating || editing !== null}
            site={editing}
            onClose={() => {
              if (editing) setEditing(null);
              else setCreating(false);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ schedule */

/** The hours, the grace and the workdays as one form; `onSave` gets the request. */
function ScheduleFields(props: {
  idPrefix: string;
  value: HrScheduleRequest;
  onChange: (value: HrScheduleRequest) => void;
  disabled?: boolean;
  /** Dialog layout (stacked fields) instead of the settings rows. */
  stacked?: boolean;
  errors: { workStart?: boolean; workEnd?: boolean; grace?: boolean };
}) {
  const { t } = useTranslation();
  const Field = props.stacked ? FormField : FormRow;
  const set = (patch: Partial<HrScheduleRequest>) => props.onChange({ ...props.value, ...patch });
  const ids = {
    start: `${props.idPrefix}-start`,
    end: `${props.idPrefix}-end`,
    grace: `${props.idPrefix}-grace`,
  };
  return (
    <>
      <Field
        label={t('hr.setup.schedule.start')}
        htmlFor={ids.start}
        error={props.errors.workStart ? 'validation.required' : undefined}
      >
        <Input
          id={ids.start}
          type="time"
          className="font-mono sm:w-40"
          value={props.value.workStart}
          disabled={props.disabled}
          onChange={(event) => set({ workStart: event.target.value })}
        />
      </Field>
      <Field
        label={t('hr.setup.schedule.end')}
        htmlFor={ids.end}
        error={props.errors.workEnd ? 'validation.required' : undefined}
      >
        <Input
          id={ids.end}
          type="time"
          className="font-mono sm:w-40"
          value={props.value.workEnd}
          disabled={props.disabled}
          onChange={(event) => set({ workEnd: event.target.value })}
        />
      </Field>
      <Field
        label={t('hr.setup.schedule.grace')}
        htmlFor={ids.grace}
        hint={t('hr.setup.schedule.graceHint')}
      >
        <Input
          id={ids.grace}
          type="number"
          inputMode="numeric"
          min={0}
          max={HR_LIMITS.maxGraceMinutes}
          className="font-mono sm:w-32"
          value={props.value.graceMinutes}
          disabled={props.disabled}
          aria-invalid={props.errors.grace ? true : undefined}
          onChange={(event) => set({ graceMinutes: Number(event.target.value) })}
        />
        {props.errors.grace ? (
          <p role="alert" className="text-sm text-destructive">
            {t('validation.integerRange', { min: 0, max: HR_LIMITS.maxGraceMinutes })}
          </p>
        ) : null}
      </Field>
      <Field label={t('hr.setup.schedule.workdays')}>
        <WeekdayChecks
          idPrefix={`${props.idPrefix}-day`}
          value={props.value.workdays}
          disabled={props.disabled}
          onChange={(workdays) => set({ workdays })}
        />
      </Field>
    </>
  );
}

function scheduleErrors(value: HrScheduleRequest) {
  return {
    workStart: !TIME_PATTERN.test(value.workStart),
    workEnd: !TIME_PATTERN.test(value.workEnd),
    grace:
      !Number.isInteger(value.graceMinutes) ||
      value.graceMinutes < 0 ||
      value.graceMinutes > HR_LIMITS.maxGraceMinutes,
  };
}

const requestOf = (schedule: HrSchedule): HrScheduleRequest => ({
  workStart: schedule.workStart,
  workEnd: schedule.workEnd,
  graceMinutes: schedule.graceMinutes,
  workdays: schedule.workdays,
});

function ScheduleCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const schedule = useHrSchedule();
  return (
    <Card role="region" aria-label={t('hr.setup.schedule.title')}>
      <CardHeader>
        <CardTitle>{t('hr.setup.schedule.title')}</CardTitle>
        <CardDescription>{t('hr.setup.schedule.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(schedule.error)} onRetry={schedule.refetch} />
        {schedule.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {schedule.data ? <ScheduleForm schedule={schedule.data} canManage={canManage} /> : null}
      </CardContent>
    </Card>
  );
}

function ScheduleForm({ schedule, canManage }: { schedule: HrSchedule; canManage: boolean }) {
  const { t } = useTranslation();
  const { saveSchedule } = useHrMutations();
  const action = useAction();
  const [value, setValue] = useState<HrScheduleRequest>(requestOf(schedule));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setValue(requestOf(schedule));
    setTouched(false);
  }, [schedule]);
  const errors = touched ? scheduleErrors(value) : {};
  const dirty = JSON.stringify(value) !== JSON.stringify(requestOf(schedule));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const check = scheduleErrors(value);
    if (check.workStart || check.workEnd || check.grace) return;
    const ok = await action.run(() => saveSchedule.mutateAsync(value));
    if (ok) toast.success(t('hr.setup.schedule.saved'));
  };
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
      <FormSection>
        <ScheduleFields
          idPrefix="schedule"
          value={value}
          onChange={setValue}
          disabled={!canManage}
          errors={errors}
        />
      </FormSection>
      {canManage ? (
        <FormFooter>
          <Button type="submit" pending={saveSchedule.isPending} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </FormFooter>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">{t('hr.readOnly')}</p>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ employees */

/** «Засах» for one person: tracked, the company schedule or their own, their sites. */
function EmployeeDialog(props: {
  employee: HrEmployee | null;
  sites: readonly WorkSite[];
  company: HrSchedule | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const employee = props.employee;
  return (
    <Dialog open={employee !== null} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {employee ? t('hr.setup.employees.editFor', { name: employee.fullName }) : ''}
          </DialogTitle>
        </DialogHeader>
        {employee ? (
          <EmployeeForm
            employee={employee}
            sites={props.sites}
            company={props.company}
            onClose={props.onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's form, mounted while it is open: starts from the person's row each time. */
function EmployeeForm(props: {
  employee: HrEmployee;
  sites: readonly WorkSite[];
  company: HrSchedule | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { saveEmployee } = useHrMutations();
  const action = useAction();
  const { employee } = props;
  const [tracked, setTracked] = useState(employee.tracked);
  const [own, setOwn] = useState(employee.workStart !== null || employee.workdays !== null);
  const [schedule, setSchedule] = useState<HrScheduleRequest>({
    workStart: employee.workStart ?? employee.schedule.workStart,
    workEnd: employee.workEnd ?? employee.schedule.workEnd,
    graceMinutes: employee.graceMinutes ?? employee.schedule.graceMinutes,
    workdays: employee.workdays ?? employee.schedule.workdays,
  });
  const [siteIds, setSiteIds] = useState<number[]>(employee.siteIds);
  const [touched, setTouched] = useState(false);
  const errors = touched && own ? scheduleErrors(schedule) : {};
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (own) {
      const check = scheduleErrors(schedule);
      if (check.workStart || check.workEnd || check.grace) return;
    }
    const ok = await action.run(() =>
      saveEmployee.mutateAsync({
        userId: employee.userId,
        body: {
          tracked,
          workStart: own ? schedule.workStart : null,
          workEnd: own ? schedule.workEnd : null,
          graceMinutes: own ? schedule.graceMinutes : null,
          workdays: own ? schedule.workdays : null,
          siteIds,
        },
      }),
    );
    if (ok) {
      toast.success(t('hr.setup.employees.saved'));
      props.onClose();
    }
  };
  const activeSites = props.sites.filter(
    (site) => site.archivedAt === null || siteIds.includes(site.id),
  );
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="employee-tracked">{t('hr.setup.employees.tracked')}</Label>
        <Switch id="employee-tracked" checked={tracked} onCheckedChange={setTracked} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="employee-company">{t('hr.companySchedule')}</Label>
        <Switch
          id="employee-company"
          checked={!own}
          onCheckedChange={(checked) => {
            setOwn(!checked);
            if (checked && props.company) setSchedule(requestOf(props.company));
          }}
        />
      </div>
      {own ? (
        <ScheduleFields
          idPrefix="employee"
          value={schedule}
          onChange={setSchedule}
          stacked
          errors={errors}
        />
      ) : null}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t('hr.setup.employees.sites')}</legend>
        <p className="text-xs text-muted-foreground">{t('hr.setup.employees.hint')}</p>
        <div className="flex flex-wrap gap-3">
          {activeSites.map((site) => {
            const id = `employee-site-${site.id}`;
            return (
              <Label key={site.id} htmlFor={id} className="flex items-center gap-1.5 font-normal">
                <Checkbox
                  id={id}
                  checked={siteIds.includes(site.id)}
                  onCheckedChange={(checked) =>
                    setSiteIds((prev) =>
                      checked === true ? [...prev, site.id] : prev.filter((x) => x !== site.id),
                    )
                  }
                />
                {site.name}
              </Label>
            );
          })}
        </div>
      </fieldset>
      <DialogFormFooter pending={saveEmployee.isPending} onCancel={props.onClose} />
    </form>
  );
}

function EmployeesCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const employees = useHrEmployees();
  const sites = useWorkSites(true);
  const schedule = useHrSchedule();
  const { saveEmployee } = useHrMutations();
  const action = useAction();
  const roleLabel = useRoleLabel();
  const workdaysText = useWorkdaysText();
  const [editing, setEditing] = useState<HrEmployee | null>(null);
  const siteNames = new Map((sites.data ?? []).map((site) => [site.id, site.name]));
  const setTracked = async (employee: HrEmployee, tracked: boolean) => {
    const ok = await action.run(() =>
      saveEmployee.mutateAsync({
        userId: employee.userId,
        body: {
          tracked,
          workStart: employee.workStart,
          workEnd: employee.workEnd,
          graceMinutes: employee.graceMinutes,
          workdays: employee.workdays,
          siteIds: employee.siteIds,
        },
      }),
    );
    if (ok) toast.success(t('hr.setup.employees.saved'));
  };
  const rows = [...(employees.data ?? [])].sort(
    (a, b) =>
      Number(a.status !== 'ACTIVE') - Number(b.status !== 'ACTIVE') ||
      Number(!a.tracked) - Number(!b.tracked) ||
      a.fullName.localeCompare(b.fullName),
  );
  return (
    <Card role="region" aria-label={t('hr.setup.employees.title')}>
      <CardHeader>
        <CardTitle>{t('hr.setup.employees.title')}</CardTitle>
        <CardDescription>{t('hr.setup.employees.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert
          problem={action.problem ?? problemFromError(employees.error)}
          onRetry={employees.refetch}
        />
        <ListCard>
          {employees.data && employees.data.length === 0 ? (
            <EmptyState title={t('hr.setup.employees.empty')} />
          ) : (
            <ListTable columns={EMPLOYEE_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.setup.employees.name')}</TableHead>
                  <TableHead>{t('hr.setup.employees.tracked')}</TableHead>
                  <TableHead>{t('hr.setup.employees.sites')}</TableHead>
                  <TableHead>{t('hr.setup.employees.hours')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.isPending ? <SkeletonRows columns={5} /> : null}
                {rows.map((employee) => {
                  const own = employee.workStart !== null || employee.workdays !== null;
                  return (
                    <TableRow
                      key={employee.userId}
                      className={employee.status !== 'ACTIVE' ? 'opacity-60' : undefined}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={employee.fullName} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium">{employee.fullName}</span>
                              {employee.status !== 'ACTIVE' ? (
                                <Badge variant="outline">{t('hr.setup.employees.disabled')}</Badge>
                              ) : null}
                            </span>
                            <span className="block truncate text-[0.75rem] text-muted-foreground">
                              {roleLabel(employee.roles)}
                            </span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          aria-label={t('hr.setup.employees.trackedFor', {
                            name: employee.fullName,
                          })}
                          checked={employee.tracked}
                          disabled={!canManage || saveEmployee.isPending}
                          onCheckedChange={(checked) => void setTracked(employee, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        {employee.siteIds.length === 0 ? (
                          <span className="text-muted-foreground">{t('hr.anySite')}</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {employee.siteIds.map((id) => (
                              <Badge key={id} variant="secondary">
                                {siteNames.get(id) ?? `#${id}`}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {own ? (
                          <span>
                            <span className="font-mono">{`${employee.schedule.workStart}–${employee.schedule.workEnd}`}</span>
                            <span className="block text-[0.75rem] text-muted-foreground">
                              {workdaysText(employee.schedule.workdays)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('hr.setup.employees.company')}
                          </span>
                        )}
                      </TableCell>
                      <RowActions>
                        {canManage ? (
                          <RowAction
                            label={t('hr.setup.employees.editFor', { name: employee.fullName })}
                            icon={Pencil}
                            onClick={() => setEditing(employee)}
                          />
                        ) : null}
                      </RowActions>
                    </TableRow>
                  );
                })}
              </TableBody>
            </ListTable>
          )}
        </ListCard>
        {canManage ? (
          <EmployeeDialog
            employee={editing}
            sites={sites.data ?? []}
            company={schedule.data}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * «Ирцийн тохиргоо» (ADR-0131): the work sites a phone must stand in to punch, the company's
 * hours and workdays, and each employee's own settings (tracked, own hours, own sites). Read-only
 * without hr.attendance.manage.
 */
export function AttendanceSetupPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  return (
    <div className="space-y-4">
      <PageHeader title={t('hr.setup.title')} description={t('hr.setup.description')} />
      {canManage ? null : (
        <p className="text-[0.8125rem] text-muted-foreground">{t('hr.readOnly')}</p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SitesCard canManage={canManage} />
        <ScheduleCard canManage={canManage} />
      </div>
      <EmployeesCard canManage={canManage} />
    </div>
  );
}
