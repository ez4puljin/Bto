import { ORDER_CHANNELS, STAGE_ACTIONS } from '@tugeel/shared/sales';
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxGroup } from '@/components/checkbox-group';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState, FilterToggle, RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBranches, useRoles } from '@/features/identity/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type SalesBoard,
  type SalesStage,
  type SalesStageRequest,
  useBoardMutations,
  useChannelDefaults,
  useSalesBoards,
} from './boards-api';

/**
 * «Борлуулалт» → «Самбарын тохиргоо» (ADR-0056 #8): the boards with their stages in order, each
 * stage's action, documents and roles, and where every channel's new orders land.
 */
export function BoardSettingsPage() {
  const { t } = useTranslation();
  const [archived, setArchived] = useState(false);
  const boards = useSalesBoards(archived);
  const [creating, setCreating] = useCreateParam();
  const list = boards.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sales.boards.settings')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('sales.boards.newBoard')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterToggle
          checked={archived}
          onCheckedChange={setArchived}
          label={t('sales.boards.showArchived')}
        />
      </div>
      <ProblemAlert problem={problemFromError(boards.error)} />
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <BoardDialog board={null} onClose={() => setCreating(false)} /> : null}
      </Dialog>
      {!boards.isPending && list.length === 0 ? (
        <EmptyState title={t('sales.boards.empty')} />
      ) : null}
      {list.map((board) => (
        <BoardCard key={board.id} board={board} />
      ))}
      <DefaultsCard boards={list.filter((board) => board.archivedAt === null)} />
    </div>
  );
}

function BoardCard({ board }: { board: SalesBoard }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const mutations = useBoardMutations();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState(false);
  const [stage, setStage] = useState<SalesStage | 'new' | null>(null);
  const [archiving, setArchiving] = useState<SalesStage | 'board' | null>(null);
  const live = board.stages.filter((entry) => entry.archivedAt === null);
  const branch = branches.data?.find((entry) => entry.id === board.branchId);

  const reorder = (from: number, to: number) =>
    void action.run(async () => {
      const ids = live.map((entry) => entry.id);
      const [moved] = ids.splice(from, 1);
      if (moved === undefined) return;
      ids.splice(to, 0, moved);
      await mutations.reorderStages.mutateAsync({ boardId: board.id, stageIds: ids });
    });
  const archive = () =>
    void action.run(async () => {
      if (archiving === 'board') await mutations.archiveBoard.mutateAsync(board.id);
      else if (archiving) await mutations.archiveStage.mutateAsync(archiving.id);
      setArchiving(null);
      toast.success(t('sales.boards.archived'));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {board.name}
          <Badge variant="secondary">{branch?.name ?? t('sales.boards.noBranch')}</Badge>
          {board.archivedAt ? (
            <Badge variant="outline">{t('sales.boards.archivedBadge')}</Badge>
          ) : null}
        </CardTitle>
        {board.archivedAt === null ? (
          <CardAction className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              {t('common.edit')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRoles(true)}>
              {t('sales.boards.roles')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStage('new')}>
              <Plus />
              {t('sales.boards.newStage')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t('sales.boards.archive')}: ${board.name}`}
              onClick={() => setArchiving('board')}
            >
              <Archive />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <ProblemAlert problem={action.problem} />
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('sales.boards.noStages')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sales.boards.stage')}</TableHead>
                <TableHead>{t('sales.boards.action')}</TableHead>
                <TableHead>{t('sales.boards.prints')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.edit')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((entry, index) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium whitespace-normal">
                    <span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>
                    {entry.name}
                  </TableCell>
                  <TableCell>{t(`sales.stageActions.${entry.action}`)}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {[
                      entry.printPickList ? t('sales.printKinds.PICK_LIST') : null,
                      entry.printDeliveryNote ? t('sales.printKinds.DELIVERY_NOTE') : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </TableCell>
                  <RowActions>
                    <RowAction
                      label={`${t('sales.boards.up')}: ${entry.name}`}
                      icon={ArrowUp}
                      disabled={index === 0 || board.archivedAt !== null}
                      onClick={() => reorder(index, index - 1)}
                    />
                    <RowAction
                      label={`${t('sales.boards.down')}: ${entry.name}`}
                      icon={ArrowDown}
                      disabled={index === live.length - 1 || board.archivedAt !== null}
                      onClick={() => reorder(index, index + 1)}
                    />
                    <RowAction
                      label={`${t('common.edit')}: ${entry.name}`}
                      icon={Pencil}
                      disabled={board.archivedAt !== null}
                      onClick={() => setStage(entry)}
                    />
                    <RowAction
                      label={`${t('sales.boards.archive')}: ${entry.name}`}
                      icon={Archive}
                      destructive
                      disabled={board.archivedAt !== null}
                      onClick={() => setArchiving(entry)}
                    />
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={editing} onOpenChange={(open) => (open ? undefined : setEditing(false))}>
        {editing ? <BoardDialog board={board} onClose={() => setEditing(false)} /> : null}
      </Dialog>
      <Dialog open={roles} onOpenChange={(open) => (open ? undefined : setRoles(false))}>
        {roles ? <BoardRolesDialog board={board} onClose={() => setRoles(false)} /> : null}
      </Dialog>
      <Dialog open={stage !== null} onOpenChange={(open) => (open ? undefined : setStage(null))}>
        {stage !== null ? (
          <StageDialog
            board={board}
            stage={stage === 'new' ? null : stage}
            onClose={() => setStage(null)}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={archiving !== null}
        title={
          archiving === 'board'
            ? t('sales.boards.archiveBoardTitle', { name: board.name })
            : t('sales.boards.archiveStageTitle', { name: archiving?.name ?? '' })
        }
        description={
          archiving === 'board'
            ? t('sales.boards.archiveBoardDescription')
            : t('sales.boards.archiveStageDescription')
        }
        confirmLabel={t('sales.boards.archive')}
        pending={mutations.archiveBoard.isPending || mutations.archiveStage.isPending}
        problem={action.problem}
        onConfirm={archive}
        onClose={() => {
          setArchiving(null);
          action.clear();
        }}
      />
    </Card>
  );
}

function BoardDialog({ board, onClose }: { board: SalesBoard | null; onClose: () => void }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const mutations = useBoardMutations();
  const action = useAction();
  const [name, setName] = useState(board?.name ?? '');
  const [branchId, setBranchId] = useState(board?.branchId ? String(board.branchId) : '');
  const save = () =>
    void action.run(async () => {
      const body = { name: name.trim(), branchId: branchId ? Number.parseInt(branchId, 10) : null };
      if (board) await mutations.updateBoard.mutateAsync({ id: board.id, ...body });
      else await mutations.createBoard.mutateAsync(body);
      toast.success(t('sales.boards.saved'));
      onClose();
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>
          {board ? t('sales.boards.editBoard') : t('sales.boards.newBoard')}
        </DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FormField label={t('sales.boards.name')} htmlFor="board-name">
          <Input
            id="board-name"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('sales.boards.branch')} htmlFor="board-branch">
          <NativeSelect
            id="board-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">{t('sales.boards.noBranch')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <ProblemAlert problem={action.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            type="submit"
            disabled={
              !name.trim() || mutations.createBoard.isPending || mutations.updateBoard.isPending
            }
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function useRoleOptions() {
  const roles = useRoles();
  return (roles.data ?? []).map((role) => ({ value: role.id, label: <RoleName role={role} /> }));
}

function BoardRolesDialog({ board, onClose }: { board: SalesBoard; onClose: () => void }) {
  const { t } = useTranslation();
  const options = useRoleOptions();
  const mutations = useBoardMutations();
  const action = useAction();
  const [view, setView] = useState<number[]>(board.roles.VIEW);
  const [manage, setManage] = useState<number[]>(board.roles.MANAGE);
  const save = () =>
    void action.run(async () => {
      await mutations.setBoardRoles.mutateAsync({ id: board.id, VIEW: view, MANAGE: manage });
      toast.success(t('sales.boards.saved'));
      onClose();
    });
  return (
    <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('sales.boards.rolesTitle', { name: board.name })}</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">{t('sales.boards.rolesHint')}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('sales.boardRights.VIEW')}</legend>
        <CheckboxGroup name="board-view" options={options} value={view} onChange={setView} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('sales.boardRights.MANAGE')}</legend>
        <CheckboxGroup name="board-manage" options={options} value={manage} onChange={setManage} />
      </fieldset>
      <ProblemAlert problem={action.problem} />
      <DialogFooter closeLabel={t('common.cancel')}>
        <Button onClick={save} disabled={mutations.setBoardRoles.isPending}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** A stage's settings: the name, what arriving does, which documents print, who may what. */
function StageDialog({
  board,
  stage,
  onClose,
}: {
  board: SalesBoard;
  stage: SalesStage | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const options = useRoleOptions();
  const mutations = useBoardMutations();
  const action = useAction();
  const [form, setForm] = useState<SalesStageRequest>({
    name: stage?.name ?? '',
    action: stage?.action ?? 'NONE',
    printPickList: stage?.printPickList ?? false,
    printDeliveryNote: stage?.printDeliveryNote ?? false,
    roles: stage?.roles ?? { VIEW: [], EDIT: [], MOVE: [] },
  });
  const patch = (fields: Partial<SalesStageRequest>) =>
    setForm((current) => ({ ...current, ...fields }));
  const save = () =>
    void action.run(async () => {
      const body = { ...form, name: form.name.trim() };
      if (stage) await mutations.updateStage.mutateAsync({ id: stage.id, body });
      else await mutations.addStage.mutateAsync({ boardId: board.id, body });
      toast.success(t('sales.boards.saved'));
      onClose();
    });
  return (
    <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {stage ? t('sales.boards.editStage') : t('sales.boards.newStage')}
        </DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FormField label={t('sales.boards.name')} htmlFor="stage-name">
          <Input
            id="stage-name"
            autoFocus
            value={form.name}
            maxLength={80}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FormField>
        <FormField
          label={t('sales.boards.action')}
          htmlFor="stage-action"
          hint={t(`sales.stageActionHints.${form.action}`)}
        >
          <NativeSelect
            id="stage-action"
            value={form.action}
            onChange={(event) => {
              const value = STAGE_ACTIONS.find((entry) => entry === event.target.value);
              if (value) patch({ action: value });
            }}
          >
            {STAGE_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.stageActions.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('sales.boards.prints')}</legend>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stage-print-pick"
              checked={form.printPickList}
              onCheckedChange={(next) => patch({ printPickList: next === true })}
            />
            <Label htmlFor="stage-print-pick" className="font-normal">
              {t('sales.printKinds.PICK_LIST')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stage-print-note"
              checked={form.printDeliveryNote}
              onCheckedChange={(next) => patch({ printDeliveryNote: next === true })}
            />
            <Label htmlFor="stage-print-note" className="font-normal">
              {t('sales.printKinds.DELIVERY_NOTE')}
            </Label>
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('sales.boards.stageRolesHint')}</p>
        {(['VIEW', 'EDIT', 'MOVE'] as const).map((right) => (
          <fieldset key={right} className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t(`sales.stageRights.${right}`)}</legend>
            <CheckboxGroup
              name={`stage-${right.toLowerCase()}`}
              options={options}
              value={form.roles[right]}
              onChange={(value) => patch({ roles: { ...form.roles, [right]: value } })}
            />
          </fieldset>
        ))}
        <ProblemAlert problem={action.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            type="submit"
            disabled={
              !form.name.trim() || mutations.addStage.isPending || mutations.updateStage.isPending
            }
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Where every channel's new orders land: a board and one of its stages, or nothing. */
function DefaultsCard({ boards }: { boards: SalesBoard[] }) {
  const { t } = useTranslation();
  const defaults = useChannelDefaults();
  const mutations = useBoardMutations();
  const action = useAction();
  const current = (channel: string) => defaults.data?.find((entry) => entry.channel === channel);
  const set = (
    channel: (typeof ORDER_CHANNELS)[number],
    boardId: number | null,
    stageId: number | null,
  ) =>
    void action.run(async () => {
      await mutations.setDefault.mutateAsync({ channel, boardId, stageId });
      toast.success(t('sales.boards.saved'));
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sales.boards.defaultsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('sales.boards.defaultsHint')}</p>
        <ProblemAlert problem={action.problem} />
        {ORDER_CHANNELS.filter((channel) => channel !== 'POS').map((channel) => {
          const own = current(channel);
          const board = boards.find((entry) => entry.id === own?.boardId);
          return (
            <div key={channel} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr]">
              <Label className="self-center">{t(`sales.channels.${channel}`)}</Label>
              <NativeSelect
                aria-label={`${t('sales.boards.board')}: ${t(`sales.channels.${channel}`)}`}
                value={own?.boardId ?? ''}
                onChange={(event) => {
                  const boardId = Number.parseInt(event.target.value, 10) || null;
                  const first = boards
                    .find((entry) => entry.id === boardId)
                    ?.stages.find((stage) => stage.archivedAt === null);
                  set(channel, boardId, boardId && first ? first.id : null);
                }}
              >
                <option value="">{t('sales.boards.noDefault')}</option>
                {boards.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label={`${t('sales.boards.stage')}: ${t(`sales.channels.${channel}`)}`}
                value={own?.stageId ?? ''}
                disabled={!board}
                onChange={(event) =>
                  board && set(channel, board.id, Number.parseInt(event.target.value, 10) || null)
                }
              >
                {(board?.stages ?? [])
                  .filter((stage) => stage.archivedAt === null)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
