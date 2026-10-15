import { Kanban, List, PanelLeftOpen, Plus, Settings2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EmptyState, FilterBar, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { problemFromError } from '@/lib/problem';
import { BoardView } from './board-view';
import { type ListFilters, ListView } from './list-view';
import { OrderFilterMenu } from './order-filter-menu';
import { orderFilterQuery, readOrderFilters, writeOrderFilters } from './order-filters';
import { OrderSheet } from './order-sheet';
import { useBoardTree, usePipeline, useStageCards } from './pipelines-api';
import { SheetFor } from './settings-page';
import { WORK_VIEWS, type WorkView, useWorkPrefs } from './work-prefs';
import { WorkPanel } from './work-panel';

/**
 * «Борлуулалт» → «Агуулахын борлуулалт» (ADR-0057 #7, after erxes Deals): the boards and their
 * pipelines on the left, the chosen pipeline as a board of stages or as a list, the search, the
 * filters and the count above. The URL keeps the pipeline (`?pipeline=`), the view (`?view=`) and
 * the filters; the last pipeline, view and panel are remembered per user in this browser.
 */
export function SalesWorkPage() {
  const { t } = useTranslation();
  const tree = useBoardTree();
  const { prefs, update } = useWorkPrefs();
  const [params, setParams] = useSearchParams();
  const canCreate = useHasPermission('sales.orders.manage');
  const isManager = useHasPermission('sales.boards.manage');
  const boards = useMemo(
    () =>
      (tree.data ?? [])
        .map((board) => ({
          ...board,
          pipelines: board.pipelines.filter((pipeline) => pipeline.archivedAt === null),
        }))
        .filter((board) => board.pipelines.length > 0),
    [tree.data],
  );
  const pipelines = boards.flatMap((board) => board.pipelines);
  const wanted = Number.parseInt(params.get('pipeline') ?? '', 10) || prefs.pipelineId;
  const current = pipelines.find((pipeline) => pipeline.id === wanted) ?? pipelines[0] ?? null;
  const board = boards.find((entry) => entry.id === current?.boardId) ?? null;
  const pipeline = usePipeline(current?.id ?? null);
  const viewParam = params.get('view');
  const view: WorkView =
    viewParam === 'list' ? 'LIST' : viewParam === 'board' ? 'BOARD' : prefs.view;
  const filters = readOrderFilters(params);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const query = orderFilterQuery(filters, q);
  const cards = useStageCards(view === 'BOARD' ? (current?.id ?? null) : null, query);
  const [listCount, setListCount] = useState<number | null>(null);
  const [listFilters, setListFilters] = useState<ListFilters>({
    scope: 'PIPELINE',
    archived: 'exclude',
  });
  const [openId, setOpenId] = useState<number | null>(
    Number.parseInt(params.get('order') ?? '', 10) || null,
  );
  const [configuring, setConfiguring] = useState(false);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const choose = (id: number) => {
    setParam('pipeline', String(id));
    update({ pipelineId: id });
    setListFilters((currentFilters) => ({ ...currentFilters, stageId: undefined }));
  };
  const showView = (next: WorkView) => {
    setParam('view', next === 'LIST' ? 'list' : 'board');
    update({ view: next });
  };
  const count =
    view === 'BOARD' ? (cards.data ?? []).reduce((sum, stage) => sum + stage.count, 0) : listCount;

  return (
    <div className="space-y-4">
      <PageHeader
        title={current?.name ?? t('sales.work.title')}
        meta={
          pipelines.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {board ? <span>{board.name}</span> : null}
              <NativeSelect
                className="lg:hidden"
                aria-label={t('sales.work.choosePipeline')}
                value={current?.id ?? ''}
                onChange={(event) => choose(Number.parseInt(event.target.value, 10))}
              >
                {boards.map((entry) => (
                  <optgroup key={entry.id} label={entry.name}>
                    {entry.pipelines.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </div>
          ) : null
        }
        actions={
          <>
            {isManager ? (
              <Button asChild variant="outline">
                <Link
                  to={board ? `/sales/boards/settings?board=${board.id}` : '/sales/boards/settings'}
                >
                  <Settings2 />
                  {t('sales.work.settings')}
                </Link>
              </Button>
            ) : pipeline.data?.canManage ? (
              <Button variant="outline" onClick={() => setConfiguring(true)}>
                <Settings2 />
                {t('sales.work.settings')}
              </Button>
            ) : null}
            {canCreate && current ? (
              <Button asChild>
                <Link to={`/sales/orders/new?pipeline=${current.id}`}>
                  <Plus />
                  {t('sales.orders.new')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ProblemAlert problem={problemFromError(tree.error) ?? problemFromError(pipeline.error)} />
      {!tree.isPending && current === null ? (
        <EmptyState
          title={t('sales.work.empty')}
          action={
            isManager ? (
              <Button asChild variant="outline">
                <Link to="/sales/boards/settings">{t('sales.work.settings')}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {current ? (
        <div className="flex items-start gap-4">
          {prefs.panelOpen ? (
            <WorkPanel
              className="hidden lg:block"
              boards={boards}
              pipelineId={current.id}
              onChoose={choose}
              onHide={() => update({ panelOpen: false })}
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-3">
            <FilterBar
              end={
                <div className="flex items-center gap-3">
                  {count !== null ? (
                    <span className="text-[13px] whitespace-nowrap text-muted-foreground">
                      {t('sales.work.count', { count })}
                    </span>
                  ) : null}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        {view === 'BOARD' ? <Kanban /> : <List />}
                        {t('sales.work.display')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t('sales.work.display')}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={view}
                        onValueChange={(value) => {
                          const next = WORK_VIEWS.find((entry) => entry === value);
                          if (next) showView(next);
                        }}
                      >
                        {WORK_VIEWS.map((entry) => (
                          <DropdownMenuRadioItem key={entry} value={entry}>
                            {t(`sales.work.views.${entry}`)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              }
            >
              {!prefs.panelOpen ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden lg:inline-flex"
                  aria-label={t('sales.work.showPanel')}
                  onClick={() => update({ panelOpen: true })}
                >
                  <PanelLeftOpen />
                </Button>
              ) : null}
              <SearchField
                aria-label={t('sales.work.search')}
                placeholder={t('sales.work.search')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setParam('q', event.target.value.trim() || null);
                }}
              />
              <OrderFilterMenu
                filters={filters}
                onChange={(next) => setParams(writeOrderFilters(params, next), { replace: true })}
              />
            </FilterBar>
            {view === 'BOARD' && pipeline.data ? (
              <BoardView
                pipeline={pipeline.data}
                filters={query}
                canCreate={canCreate}
                onOpen={setOpenId}
              />
            ) : null}
            {view === 'LIST' ? (
              <ListView
                pipeline={pipeline.data ?? null}
                filters={query}
                own={listFilters}
                onOwnChange={setListFilters}
                onOpen={setOpenId}
                onCount={setListCount}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <OrderSheet orderId={openId} onClose={() => setOpenId(null)} />
      {configuring && current ? (
        <SheetFor
          pipelineId={current.id}
          boardId={current.boardId}
          boards={tree.data ?? []}
          onClose={() => setConfiguring(false)}
        />
      ) : null}
    </div>
  );
}
