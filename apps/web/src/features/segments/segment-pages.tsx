import {
  SEGMENT_ENTITIES,
  segmentIssue,
  type SegmentDefinition,
  type SegmentEntity,
  MAX_SEGMENT_DESCRIPTION,
  MAX_SEGMENT_NAME,
} from '@tugeel/shared/segments';
import { Archive, Pencil, Plus, Shapes } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('segments.columns.name')}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t('segments.columns.description')}
              </TableHead>
              <TableHead className="text-right">{t('segments.columns.count')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.isPending ? <SkeletonRows columns={4} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/segments/${row.id}`}>
                <TableCell>
                  <Link
                    to={`/segments/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">
                  {row.description ?? t('common.none')}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {countText(entity, counts.data ? (countOf.get(row.id) ?? null) : undefined)}
                </TableCell>
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
      <div>
        <PageHeader title={t('segments.title')} />
        <ProblemAlert problem={problemFromError(segment.error)} />
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
    <div>
      <PageHeader
        title={data.name}
        crumbs={[
          { label: t(`segments.entities.${data.entity}`), to: `/segments?entity=${data.entity}` },
        ]}
        meta={
          <>
            <Badge variant="secondary">{t(`segments.entities.${data.entity}`)}</Badge>
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
                <Button asChild variant="outline">
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
      <ProblemAlert problem={problemFromError(counts.error)} />
      <Card>
        <CardHeader>
          <CardTitle>{t('segments.conditions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.description ? (
            <FieldList items={[{ label: t('segments.description'), value: data.description }]} />
          ) : null}
          <DefinitionText entity={data.entity} definition={data.definition} />
        </CardContent>
      </Card>
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
    <div>
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
    <div>
      <PageHeader
        title={data ? data.name : t('segments.edit')}
        crumbs={data ? [{ label: data.name, to: `/segments/${data.id}` }] : []}
      />
      <ProblemAlert problem={problemFromError(segment.error)} />
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

function SegmentForm(props: {
  entity: SegmentEntity;
  definition: SegmentDefinition;
  segment?: Segment;
}) {
  const { t } = useTranslation();
  const { entity, segment } = props;
  const navigate = useNavigate();
  const mutations = useSegmentMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [definition, setDefinition] = useState<SegmentDefinition>(props.definition);
  const [submitted, setSubmitted] = useState(false);
  const issue = segmentIssue(entity, definition);
  const settled = useSettled(definition);
  const preview = useSegmentPreview(entity, settled, segmentIssue(entity, settled) === null);
  const pending = mutations.create.isPending || mutations.update.isPending;
  const nameMissing = submitted && name.trim() === '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === '' || issue) return;
    const body = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      definition,
    };
    let savedId = 0;
    const ok = await action.run(async () => {
      const saved = segment
        ? await mutations.update.mutateAsync({ id: segment.id, ...body })
        : await mutations.create.mutateAsync({ key, entity, ...body });
      savedId = saved.id;
    });
    if (ok) {
      toast.success(t('segments.saved'));
      void navigate(`/segments/${savedId}`, { replace: true });
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)} noValidate>
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
          <span className="text-sm">{t(`segments.entities.${entity}`)}</span>
        </FormRow>
      </FormSection>
      <FormSection title={t('segments.conditions')} description={t('segments.conditionsHint')}>
        <div className="p-3">
          <DefinitionEditor entity={entity} value={definition} onChange={setDefinition} />
        </div>
      </FormSection>
      <p role="status" className="text-sm tabular-nums">
        {issue ? (
          <span className="text-destructive">{t(`segments.issues.${issue.issue}`)}</span>
        ) : preview.isFetching ? (
          <span className="text-muted-foreground">{t('segments.counting')}</span>
        ) : typeof preview.data === 'number' ? (
          t('segments.liveCount', { count: formatCount(preview.data) })
        ) : null}
      </p>
      <ProblemAlert problem={action.problem ?? problemFromError(preview.error)} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={() => void navigate(-1)}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
