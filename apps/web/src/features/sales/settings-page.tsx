import { Ellipsis, Hash, Plus, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, FilterToggle, ListCard } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { PipelineSheet } from './pipeline-sheet';
import {
  type PipelineSummary,
  type SalesBoard,
  useBoardTree,
  useNumbering,
  usePipeline,
  useSalesMutations,
} from './pipelines-api';
import { BoardDialog, ChannelsDialog, CopyDialog, NumberingDialog } from './settings-dialogs';

type Confirming =
  { kind: 'pipeline'; pipeline: PipelineSummary } | { kind: 'board'; board: SalesBoard };

/**
 * «Самбар ба дамжлага» (ADR-0057 #7, after erxes's boards and pipelines): the boards on the left,
 * the chosen board's pipelines as a table on the right with a «⋯» per row, «Дугаарлалт»,
 * «Сувгийн тохиргоо» and «+ Дамжлага нэмэх» in the header.
 */
export function SalesSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const tree = useBoardTree(archived);
  const numbering = useNumbering();
  const mutations = useSalesMutations();
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const boards = tree.data ?? [];
  const wanted = Number.parseInt(params.get('board') ?? '', 10);
  const board = boards.find((entry) => entry.id === wanted) ?? boards[0] ?? null;
  const [dialog, setDialog] = useState<
    | { kind: 'board'; board: SalesBoard | null }
    | { kind: 'numbering' }
    | { kind: 'channels' }
    | { kind: 'copy'; pipeline: PipelineSummary }
    | null
  >(null);
  const [sheet, setSheet] = useState<{ pipelineId: number | null } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const choose = (id: number) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('board', String(id));
        return next;
      },
      { replace: true },
    );
  const restore = (run: () => Promise<unknown>) =>
    void action.run(async () => {
      await run();
      toast.success(t('sales.pipelines.restored'));
    });
  const archive = () =>
    void action.run(async () => {
      if (!confirming) return;
      if (confirming.kind === 'pipeline') {
        await mutations.archivePipeline.mutateAsync(confirming.pipeline.id);
      } else {
        await mutations.archiveBoard.mutateAsync(confirming.board.id);
      }
      setConfirming(null);
      toast.success(t('sales.boards.archived'));
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sales.pipelines.title')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!numbering.data}
              onClick={() => setDialog({ kind: 'numbering' })}
            >
              <Hash />
              {t('sales.numbering.button')}
            </Button>
            <Button variant="outline" onClick={() => setDialog({ kind: 'channels' })}>
              <Workflow />
              {t('sales.channelsDialog.button')}
            </Button>
            <Button
              disabled={!board || board.archivedAt !== null}
              onClick={() => setSheet({ pipelineId: null })}
            >
              <Plus />
              {t('sales.pipelines.newPipeline')}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterToggle
          checked={archived}
          onCheckedChange={setArchived}
          label={t('sales.pipelines.showArchived')}
        />
      </div>
      <ProblemAlert
        problem={problemFromError(tree.error) ?? (confirming ? null : action.problem)}
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ListCard className="self-start">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">
              {t('sales.pipelines.boardsTitle', { count: boards.length })}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('sales.pipelines.newBoard')}
              onClick={() => setDialog({ kind: 'board', board: null })}
            >
              <Plus />
            </Button>
          </div>
          {!tree.isPending && boards.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {t('sales.pipelines.noBoards')}
            </p>
          ) : null}
          <ul className="flex flex-col p-1">
            {boards.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={entry.id === board?.id ? 'true' : undefined}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                    entry.id === board?.id && 'bg-secondary font-medium text-secondary-foreground',
                  )}
                  onClick={() => choose(entry.id)}
                >
                  {entry.name}
                  {entry.archivedAt ? (
                    <Badge variant="outline" className="ml-2">
                      {t('sales.boards.archivedBadge')}
                    </Badge>
                  ) : null}
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('sales.pipelines.rowMenu', { name: entry.name })}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog({ kind: 'board', board: entry })}>
                      {t('sales.pipelines.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {entry.archivedAt ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          restore(() => mutations.unarchiveBoard.mutateAsync(entry.id))
                        }
                      >
                        {t('sales.pipelines.unarchive')}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          action.clear();
                          setConfirming({ kind: 'board', board: entry });
                        }}
                      >
                        {t('sales.pipelines.archive')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        </ListCard>
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold">
            {t('sales.pipelines.pipelinesTitle', { count: board?.pipelines.length ?? 0 })}
          </h2>
          <ListCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sales.pipelines.columns.name')}</TableHead>
                  <TableHead>{t('sales.pipelines.columns.createdAt')}</TableHead>
                  <TableHead>{t('sales.pipelines.columns.createdBy')}</TableHead>
                  <TableHead>{t('sales.pipelines.columns.status')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.edit')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(board?.pipelines ?? []).map((pipeline) => (
                  <TableRow key={pipeline.id}>
                    <TableCell className="font-medium whitespace-normal">
                      <button
                        type="button"
                        className="text-left text-link underline-offset-4 hover:underline"
                        onClick={() => setSheet({ pipelineId: pipeline.id })}
                      >
                        {pipeline.name}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {formatUbDateTime(Date.parse(pipeline.createdAt))}
                    </TableCell>
                    <TableCell>{pipeline.createdByName ?? ''}</TableCell>
                    <TableCell>
                      {pipeline.archivedAt ? (
                        <Badge variant="outline">{t('sales.pipelines.statuses.archived')}</Badge>
                      ) : (
                        <Badge variant="success">{t('sales.pipelines.statuses.active')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('sales.pipelines.rowMenu', { name: pipeline.name })}
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setSheet({ pipelineId: pipeline.id })}>
                            {t('sales.pipelines.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'copy', pipeline })}>
                            {t('sales.pipelines.copy')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={pipeline.archivedAt !== null}
                            onSelect={() => void navigate(`/sales/boards?pipeline=${pipeline.id}`)}
                          >
                            {t('sales.pipelines.open')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {pipeline.archivedAt ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                restore(() => mutations.unarchivePipeline.mutateAsync(pipeline.id))
                              }
                            >
                              {t('sales.pipelines.unarchive')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                action.clear();
                                setConfirming({ kind: 'pipeline', pipeline });
                              }}
                            >
                              {t('sales.pipelines.archive')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {board && board.pipelines.length === 0 ? (
              <EmptyState title={t('sales.pipelines.empty')} />
            ) : null}
          </ListCard>
        </div>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        {dialog?.kind === 'board' ? (
          <BoardDialog board={dialog.board} onClose={() => setDialog(null)} />
        ) : null}
        {dialog?.kind === 'numbering' && numbering.data ? (
          <NumberingDialog numbering={numbering.data} onClose={() => setDialog(null)} />
        ) : null}
        {dialog?.kind === 'channels' ? <ChannelsDialog boards={boards} /> : null}
        {dialog?.kind === 'copy' ? (
          <CopyDialog
            source={dialog.pipeline}
            boards={boards}
            onClose={(copiedId) => {
              setDialog(null);
              if (copiedId) setSheet({ pipelineId: copiedId });
            }}
          />
        ) : null}
      </Dialog>
      {sheet ? (
        <SheetFor
          pipelineId={sheet.pipelineId}
          boardId={board?.id ?? null}
          boards={boards}
          onClose={() => setSheet(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.kind === 'board'
            ? t('sales.pipelines.archiveBoardTitle', { name: confirming.board.name })
            : t('sales.pipelines.archiveTitle', {
                name: confirming?.kind === 'pipeline' ? confirming.pipeline.name : '',
              })
        }
        description={
          confirming?.kind === 'board'
            ? t('sales.pipelines.archiveBoardDescription')
            : t('sales.pipelines.archiveDescription')
        }
        confirmLabel={t('sales.pipelines.archive')}
        pending={mutations.archivePipeline.isPending || mutations.archiveBoard.isPending}
        problem={action.problem}
        onConfirm={archive}
        onClose={() => {
          setConfirming(null);
          action.clear();
        }}
      />
    </div>
  );
}

/** The pipeline sheet once the pipeline (when editing) has loaded. */
export function SheetFor({
  pipelineId,
  boardId,
  boards,
  onClose,
}: {
  pipelineId: number | null;
  boardId: number | null;
  boards: readonly SalesBoard[];
  onClose: () => void;
}) {
  const pipeline = usePipeline(pipelineId);
  if (pipelineId !== null && !pipeline.data) return null;
  return (
    <PipelineSheet
      key={pipelineId ?? 'new'}
      pipeline={pipeline.data ?? null}
      boardId={boardId}
      boards={boards}
      onClose={onClose}
    />
  );
}
