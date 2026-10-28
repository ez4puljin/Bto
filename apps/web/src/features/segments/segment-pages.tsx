import {
  SEGMENT_ENTITIES,
  segmentIssue,
  type SegmentDefinition,
  type SegmentEntity,
  MAX_SEGMENT_DESCRIPTION,
  MAX_SEGMENT_NAME,
} from '@tugeel/shared/segments';
import { Archive, ArrowDown, ArrowUp, Pencil, Plus, Shapes, Smartphone } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldList } from '@/components/detail';
import { FormRow, FormSection } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type Segment,
  useSegment,
  useSegmentCounts,
  useSegmentMutations,
  useSegmentPages,
  useSegmentPreview,
} from './api';
import { DefinitionEditor, DefinitionText } from './conditions';
import {
  definitionFromProductList,
  ENTITY_LISTS,
  isSegmentEntity,
  newDefinition,
} from './segment-definition';

/** The entities the user may see segments of: customer segments need `partners.customers.read`. */
function useReadableEntities(): readonly SegmentEntity[] {
  const canReadCustomers = useHasPermission('partners.customers.read');
  return SEGMENT_ENTITIES.filter((entity) => entity !== 'CUSTOMER' || canReadCustomers);
}

/** How many records a segment keeps, in words; «…» while counting. */
function useCountText() {
  const { t } = useTranslation();
  return (entity: SegmentEntity, count: number | null | undefined) =>
    count === undefined
      ? '…'
      : count === null
        ? t('segments.countUnavailable')
        : t(`segments.countOf.${entity}`, { count: formatCount(count) });
}

/**
 * Segments (ADR-0049): the saved conditions of one entity at a time, by name, with how many records
 * each keeps (one read per page). Everyone reads them; `segments.manage` creates them.
 */
export function SegmentsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('segments.manage');
  const entities = useReadableEntities();
  const [params, setParams] = useSearchParams();
  const param = params.get('entity');
  const entity = isSegmentEntity(param) && entities.includes(param) ? param : 'PRODUCT';
  const segments = useSegmentPages(entity);
  const rows = useMemo(
    () => segments.data?.pages.flatMap((page) => page.data) ?? [],
    [segments.data],
  );
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const counts = useSegmentCounts(ids);
  const countOf = new Map(counts.data?.map((row) => [row.segmentId, row.count]));
  const countText = useCountText();
  const empty = !segments.isPending && rows.length === 0;
  const createLink = `/segments/new?entity=${entity}`;
  return (
    <div>
      <PageHeader
        title={t('segments.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to={createLink}>
                <Plus />
                {t('segments.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SegmentedControl
          options={entities}
          value={entity}
          label={(value) => t(`segments.entities.${value}`)}
          onChange={(value) => setParams({ entity: value }, { replace: true })}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(segments.error) ?? problemFromError(counts.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('segments.columns.name')}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t('segments.columns.description')}
              </TableHead>
              <TableHead className="text-right">{t('segments.columns.count')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.isPending ? <SkeletonRows columns={5} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/segments/${row.id}`}>
                <TableCell>
                  <Link
                    to={`/segments/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.kind === 'LIST' ? (
                    <Badge variant="secondary" className="ml-2">
                      {t('segments.kinds.LIST')}
                    </Badge>
                  ) : null}
                  {row.appRank !== null ? (
                    <Badge variant="default" className="ml-2" title={t('segments.app.badgeHint')}>
                      {t('segments.app.badge')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TruncateCell
                  text={row.description ?? t('common.none')}
                  className="hidden text-muted-foreground md:table-cell"
                />
                <TableCell className="text-right tabular-nums">
                  {countText(entity, counts.data ? (countOf.get(row.id) ?? null) : undefined)}
                </TableCell>
                <SpacerCell />
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {empty ? <EmptyState icon={Shapes} title={t('segments.empty')} /> : null}
        <LoadMore query={segments} />
      </ListCard>
    </div>
  );
}

const positiveId = (value: string | undefined) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
};

/**
 * A segment: its conditions in words, how many records it keeps and «Жагсаалтаар харах» (the
 * entity's list filtered by it). Admins change or archive it.
 */
export function SegmentPage() {
  const { t } = useTranslation();
  const id = positiveId(useParams().id);
  const canManage = useHasPermission('segments.manage');
  const segment = useSegment(id);
  const counts = useSegmentCounts(segment.data ? [id] : []);
  const countText = useCountText();
  const mutations = useSegmentMutations();
  const archiving = useAction();
  const [asking, setAsking] = useState(false);
  const navigate = useNavigate();
  const data = segment.data;
  if (!data) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={t('segments.title')} />
        <ProblemAlert problem={problemFromError(segment.error)} onRetry={segment.refetch} />
        {segment.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
      </div>
    );
  }
  const archive = async () => {
    if (await archiving.run(() => mutations.archive.mutateAsync(data.id))) {
      toast.success(t('segments.archived'));
      void navigate(`/segments?entity=${data.entity}`, { replace: true });
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={data.name}
        crumbs={[
          { label: t(`segments.entities.${data.entity}`), to: `/segments?entity=${data.entity}` },
        ]}
        meta={
          <>
            <Badge variant="secondary">{t(`segments.entities.${data.entity}`)}</Badge>
            {data.kind === 'LIST' ? (
              <Badge variant="secondary">{t('segments.kinds.LIST')}</Badge>
            ) : null}
            <span className="tabular-nums">
              {countText(data.entity, counts.data ? (counts.data[0]?.count ?? null) : undefined)}
            </span>
          </>
        }
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="outline" onClick={() => setAsking(true)}>
                  <Archive />
                  {t('segments.archive')}
                </Button>
                <Button asChild variant="secondary">
                  <Link to={`/segments/${data.id}/edit`}>
                    <Pencil />
                    {t('common.edit')}
                  </Link>
                </Button>
              </>
            ) : null}
            <Button asChild>
              <Link to={`${ENTITY_LISTS[data.entity]}?segment=${data.id}`}>
                {t('segments.viewList')}
              </Link>
            </Button>
          </>
        }
      />
      <ProblemAlert problem={problemFromError(counts.error)} onRetry={counts.refetch} />
      <Card>
        <CardHeader>
          <CardTitle>
            {data.definition ? t('segments.conditions') : t('segments.list.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.description ? (
            <FieldList items={[{ label: t('segments.description'), value: data.description }]} />
          ) : null}
          {data.definition ? (
            <DefinitionText entity={data.entity} definition={data.definition} />
          ) : (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p>{t('segments.list.hint')}</p>
              {/* Only those who may change its products are told how. */}
              {canManage ? <p>{t('segments.list.howTo')}</p> : null}
            </div>
          )}
        </CardContent>
      </Card>
      {data.entity === 'PRODUCT' ? <AppCard segment={data} /> : null}
      <ConfirmDialog
        open={asking}
        title={t('segments.archiveTitle', { name: data.name })}
        description={t('segments.archiveHint')}
        confirmLabel={t('segments.archive')}
        pending={mutations.archive.isPending}
        problem={archiving.problem}
        onConfirm={() => void archive()}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}

/**
 * «Bto300 апп» (ADR-0092 #2): whether «Bto300»'s home shows the product segment as a section (its
 * name the title, its description the subtitle) and its place among the shown segments; holders
 * of customer.home.manage switch it and move it up or down, everyone else reads it.
 */
function AppCard({ segment }: { segment: Segment }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const mutations = useSegmentMutations();
  const action = useAction();
  const shown = segment.appRank !== null;
  const rank = segment.appRank ?? 0;
  const count = segment.appShownCount ?? 0;
  const busy = mutations.showInApp.isPending || mutations.moveInApp.isPending;
  const toggle = async (next: boolean) => {
    const ok = await action.run(() =>
      mutations.showInApp.mutateAsync({ id: segment.id, shown: next }),
    );
    if (ok) toast.success(next ? t('segments.app.shownToast') : t('segments.app.hiddenToast'));
  };
  const move = (direction: 'UP' | 'DOWN') =>
    void action.run(() => mutations.moveInApp.mutateAsync({ id: segment.id, direction }));
  return (
    <Card role="region" aria-label={t('segments.app.title')} className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone aria-hidden className="size-4 text-muted-foreground" />
          {t('segments.app.title')}
        </CardTitle>
        <CardDescription>{t('segments.app.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        {canManage ? (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="segment-app-shown">{t('segments.app.shown')}</Label>
            <Switch
              id="segment-app-shown"
              checked={shown}
              disabled={busy}
              onCheckedChange={(next) => void toggle(next)}
            />
          </div>
        ) : (
          <p className="text-sm">
            {shown ? t('segments.app.isShown') : t('segments.app.isHidden')}
          </p>
        )}
        {shown ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('segments.app.rank', { rank, count })}</span>
            {canManage ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || rank <= 1}
                  onClick={() => move('UP')}
                >
                  <ArrowUp />
                  {t('segments.app.up')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || rank >= count}
                  onClick={() => move('DOWN')}
                >
                  <ArrowDown />
                  {t('segments.app.down')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        <p className="text-[13px] text-muted-foreground">{t('segments.app.orderHint')}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Creates (`/segments/new?entity=`) or changes (`/segments/:id/edit`) a segment: name, description
 * and the conditions, with a live count while they pass the shared rules. «Сегмент болгох» on the
 * product list opens it with that list's filters (`from=`).
 */
export function SegmentEditorPage() {
  const { t } = useTranslation();
  const routeId = useParams().id;
  const [params] = useSearchParams();
  const entities = useReadableEntities();
  if (routeId !== undefined) return <EditSegment id={positiveId(routeId)} />;
  const param = params.get('entity');
  const entity = isSegmentEntity(param) && entities.includes(param) ? param : 'PRODUCT';
  const from = params.get('from');
  const definition =
    entity === 'PRODUCT' && from !== null
      ? definitionFromProductList(new URLSearchParams(from))
      : newDefinition(entity);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t('segments.create')}
        crumbs={[{ label: t(`segments.entities.${entity}`), to: `/segments?entity=${entity}` }]}
      />
      <SegmentForm entity={entity} definition={definition} />
    </div>
  );
}

function EditSegment({ id }: { id: number }) {
  const { t } = useTranslation();
  const segment = useSegment(id);
  const data = segment.data;
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={data ? data.name : t('segments.edit')}
        crumbs={data ? [{ label: data.name, to: `/segments/${data.id}` }] : []}
      />
      <ProblemAlert problem={problemFromError(segment.error)} onRetry={segment.refetch} />
      {data ? (
        <SegmentForm entity={data.entity} definition={data.definition} segment={data} />
      ) : segment.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : null}
    </div>
  );
}

/** The value a while after it last changed: the live count waits for typing to pause. */
function useSettled<T>(value: T, delay = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The segment form. A hand-picked segment (ADR-0052) shows its name and description only: its
 * products change from the product list's ticks.
 */
function SegmentForm(props: {
  entity: SegmentEntity;
  /** Null for a hand-picked segment. */
  definition: SegmentDefinition | null;
  segment?: Segment;
}) {
  const { t } = useTranslation();
  const { entity, segment } = props;
  const isList = props.definition === null;
  const navigate = useNavigate();
  const mutations = useSegmentMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [definition, setDefinition] = useState<SegmentDefinition>(
    props.definition ?? newDefinition(entity),
  );
  const [submitted, setSubmitted] = useState(false);
  // A fresh form is not scolded: the rules speak once the conditions were touched or Save pressed.
  const [touched, setTouched] = useState(false);
  const issue = isList ? null : segmentIssue(entity, definition);
  const issueShown = submitted || touched ? issue : null;
  const settled = useSettled(definition);
  const preview = useSegmentPreview(
    entity,
    settled,
    !isList && segmentIssue(entity, settled) === null,
  );
  const pending = mutations.create.isPending || mutations.update.isPending;
  const nameMissing = submitted && name.trim() === '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === '' || issue) return;
    const details = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
    };
    let savedId = 0;
    const ok = await action.run(async () => {
      const saved = segment
        ? await mutations.update.mutateAsync({
            id: segment.id,
            ...details,
            ...(isList ? {} : { definition }),
          })
        : await mutations.create.mutateAsync({ key, entity, ...details, definition });
      savedId = saved.id;
    });
    if (ok) {
      toast.success(t('segments.saved'));
      void navigate(`/segments/${savedId}`, { replace: true });
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <FormSection title={t('segments.general')}>
            <FormRow
              label={t('segments.name')}
              htmlFor="segment-name"
              error={nameMissing ? 'validation.required' : undefined}
            >
              <Input
                id="segment-name"
                maxLength={MAX_SEGMENT_NAME}
                aria-invalid={nameMissing || undefined}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormRow>
            <FormRow label={t('segments.description')} htmlFor="segment-description">
              <Textarea
                id="segment-description"
                rows={2}
                maxLength={MAX_SEGMENT_DESCRIPTION}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormRow>
            <FormRow label={t('segments.entity')} align="center">
              <span className="text-sm">
                {t(`segments.entities.${entity}`)}
                {isList ? ` · ${t('segments.kinds.LIST')}` : null}
              </span>
            </FormRow>
          </FormSection>
          {isList ? (
            <div className="flex flex-col gap-1 px-1 text-sm text-muted-foreground">
              <p>{t('segments.list.hint')}</p>
              <p>{t('segments.list.howTo')}</p>
            </div>
          ) : (
            <>
              <FormSection
                title={t('segments.conditions')}
                description={t('segments.conditionsHint')}
                // The live count (or what the rules miss) beside the conditions' title.
                action={
                  <p role="status" className="max-w-[55%] text-right text-[13px] tabular-nums">
                    {issueShown ? (
                      <span className="text-destructive">
                        {t(`segments.issues.${issueShown.issue}`)}
                      </span>
                    ) : issue ? null : preview.isFetching ? (
                      <span className="text-muted-foreground">{t('segments.counting')}</span>
                    ) : typeof preview.data === 'number' ? (
                      t('segments.liveCount', { count: formatCount(preview.data) })
                    ) : null}
                  </p>
                }
              >
                <div className="p-3">
                  <DefinitionEditor
                    entity={entity}
                    value={definition}
                    onChange={(next) => {
                      setTouched(true);
                      setDefinition(next);
                    }}
                  />
                </div>
              </FormSection>
            </>
          )}
        </CardContent>
      </Card>
      <ProblemAlert problem={action.problem ?? problemFromError(preview.error)} />
      <StickyActions>
        {/* Back to the record, or to the list it would join: never a step back out of the app. */}
        <Button variant="ghost" asChild>
          <Link to={segment ? `/segments/${segment.id}` : `/segments?entity=${entity}`}>
            {t('common.cancel')}
          </Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
      </StickyActions>
    </form>
  );
}
