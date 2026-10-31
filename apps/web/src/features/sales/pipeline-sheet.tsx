import {
  KIND_STAGE_ACTIONS,
  PIPELINE_KINDS,
  type PipelineKind,
  type PipelineRight,
  type PipelineVisibility,
} from '@tugeel/shared/sales';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxGroup } from '@/components/checkbox-group';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { RowAction, RowActions, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useWarehouses } from '@/features/identity/api';
import {
  type PipelineRequest,
  type SalesBoard,
  type SalesPipeline,
  type StageInput,
  useSalesMutations,
} from './pipelines-api';
import { useRoleOptions } from './role-options';
import { StageDialog } from './stage-dialog';

const VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const satisfies readonly PipelineVisibility[];

interface StageRow extends StageInput {
  key: string;
}

/**
 * «Дамжлага нэмэх» / «Дамжлага засах» (ADR-0057 #1, #7): a side sheet with the tabs «Ерөнхий»
 * (name, board, who sees it, who manages it, own orders only) and «Шатууд» (the stages in their
 * order, each edited in its dialog); one «Хадгалах» saves everything at once. A stage taken out is
 * archived when saved (refused while an unfinished order sits there).
 */
export function PipelineSheet({
  pipeline,
  boardId,
  boards,
  onClose,
}: {
  /** The pipeline to edit; null for a new one in `boardId`. */
  pipeline: SalesPipeline | null;
  boardId: number | null;
  boards: readonly SalesBoard[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const options = useRoleOptions();
  const mutations = useSalesMutations();
  const action = useAction();
  const [tab, setTab] = useState('general');
  const [name, setName] = useState(pipeline?.name ?? '');
  const [board, setBoard] = useState<number | null>(pipeline?.boardId ?? boardId);
  const [visibility, setVisibility] = useState<PipelineVisibility>(
    pipeline?.visibility ?? 'PUBLIC',
  );
  const [ownOrdersOnly, setOwnOrdersOnly] = useState(pipeline?.ownOrdersOnly ?? false);
  const [kind, setKind] = useState<PipelineKind>(pipeline?.kind ?? 'SALES');
  const [transferWarehouseId, setTransferWarehouseId] = useState<number | null>(
    pipeline?.transferWarehouseId ?? null,
  );
  const warehouses = useWarehouses();
  const stores = (warehouses.data ?? []).filter(
    (entry) =>
      entry.kind === 'STORE' && (entry.status === 'ACTIVE' || entry.id === transferWarehouseId),
  );
  const [roles, setRoles] = useState<Record<PipelineRight, number[]>>(
    pipeline?.roles ?? { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
  );
  const [stages, setStages] = useState<StageRow[]>(() =>
    (pipeline?.stages ?? [])
      .filter((stage) => stage.archivedAt === null)
      .map((stage) => ({
        key: String(stage.id),
        id: stage.id,
        name: stage.name,
        action: stage.action,
        printPickList: stage.printPickList,
        printDeliveryNote: stage.printDeliveryNote,
        roles: stage.roles,
      })),
  );
  const [editing, setEditing] = useState<StageRow | 'new' | null>(null);
  // Closing with edits not saved asks first (the order panel's question).
  const snapshot = JSON.stringify({
    name,
    board,
    visibility,
    ownOrdersOnly,
    kind,
    transferWarehouseId,
    roles,
    stages: stages.map(({ key: _key, ...stage }) => stage),
  });
  const [initial] = useState(snapshot);
  const [leaving, setLeaving] = useState(false);
  const requestClose = () => {
    if (snapshot !== initial) setLeaving(true);
    else onClose();
  };
  const setRight = (right: PipelineRight, value: number[]) =>
    setRoles((current) => ({ ...current, [right]: value }));
  const move = (from: number, to: number) =>
    setStages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  const pending = mutations.createPipeline.isPending || mutations.savePipeline.isPending;
  const save = () =>
    void action.run(async () => {
      if (board === null) return;
      const body: PipelineRequest = {
        boardId: board,
        name: name.trim(),
        visibility,
        ownOrdersOnly,
        kind,
        transferWarehouseId: kind === 'TRANSFER' ? transferWarehouseId : null,
        roles: {
          VIEW: visibility === 'PRIVATE' ? roles.VIEW : [],
          MANAGE: roles.MANAGE,
          ALL_ORDERS: ownOrdersOnly ? roles.ALL_ORDERS : [],
        },
        stages: stages.map(({ key: _key, ...stage }) => stage),
      };
      if (pipeline) await mutations.savePipeline.mutateAsync({ id: pipeline.id, body });
      else await mutations.createPipeline.mutateAsync(body);
      toast.success(pipeline ? t('sales.pipelines.saved') : t('sales.pipelines.created'));
      onClose();
    });

  return (
    <>
      <Sheet open onOpenChange={(open) => (open ? undefined : requestClose())}>
        <SheetContent closeLabel={t('common.close')} className="sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {pipeline ? t('sales.pipelines.editPipeline') : t('sales.pipelines.newPipeline')}
            </SheetTitle>
            <SheetDescription>
              {pipeline?.name ?? t('sales.pipelines.newDescription')}
            </SheetDescription>
          </SheetHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="general">{t('sales.pipelines.tabs.general')}</TabsTrigger>
              <TabsTrigger value="stages">
                {t('sales.pipelines.tabs.stages')}
                <Badge variant="secondary">{stages.length}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t('sales.boards.name')} htmlFor="pipeline-name">
                  <Input
                    id="pipeline-name"
                    autoFocus
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
                <FormField label={t('sales.pipelines.board')} htmlFor="pipeline-board">
                  <NativeSelect
                    id="pipeline-board"
                    value={board ?? ''}
                    onChange={(event) => setBoard(Number.parseInt(event.target.value, 10) || null)}
                  >
                    {boards
                      .filter((entry) => entry.archivedAt === null || entry.id === board)
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </NativeSelect>
                </FormField>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t('sales.pipelines.visibility')}</legend>
                <SegmentedControl
                  options={VISIBILITIES}
                  value={visibility}
                  label={(value) => t(`sales.pipelines.visibilities.${value}`)}
                  onChange={setVisibility}
                />
                <p className="text-xs text-muted-foreground">
                  {t(`sales.pipelines.visibilityHints.${visibility}`)}
                </p>
              </fieldset>
              {visibility === 'PRIVATE' ? (
                <RolesField
                  right="VIEW"
                  options={options}
                  value={roles.VIEW}
                  onChange={(value) => setRight('VIEW', value)}
                />
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t('sales.pipelines.kind')}</legend>
                <SegmentedControl
                  options={PIPELINE_KINDS}
                  value={kind}
                  label={(value) => t(`sales.pipelines.kinds.${value}`)}
                  onChange={setKind}
                />
                <p className="text-xs text-muted-foreground">
                  {t(`sales.pipelines.kindHints.${kind}`)}
                </p>
              </fieldset>
              {kind === 'TRANSFER' ? (
                <FormField
                  label={t('sales.pipelines.transferWarehouse')}
                  htmlFor="pipeline-transfer"
                  hint={t('sales.pipelines.transferWarehouseHint')}
                >
                  <NativeSelect
                    id="pipeline-transfer"
                    value={transferWarehouseId ?? ''}
                    onChange={(event) =>
                      setTransferWarehouseId(Number.parseInt(event.target.value, 10) || null)
                    }
                  >
                    {stores.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
              <RolesField
                right="MANAGE"
                hint={t('sales.pipelines.manageHint')}
                options={options}
                value={roles.MANAGE}
                onChange={(value) => setRight('MANAGE', value)}
              />
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="pipeline-own">{t('sales.pipelines.ownOrdersOnly')}</Label>
                  <Switch
                    id="pipeline-own"
                    checked={ownOrdersOnly}
                    onCheckedChange={setOwnOrdersOnly}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sales.pipelines.ownOrdersOnlyHint')}
                </p>
                {ownOrdersOnly ? (
                  <RolesField
                    right="ALL_ORDERS"
                    options={options}
                    value={roles.ALL_ORDERS}
                    onChange={(value) => setRight('ALL_ORDERS', value)}
                  />
                ) : null}
              </div>
            </TabsContent>
            <TabsContent value="stages" className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">{t('sales.pipelines.stagesHint')}</p>
              <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {stages.map((stage, index) => (
                  <li key={stage.key} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-5 font-mono text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{stage.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          t(`sales.stageActions.${stage.action}`),
                          stage.printPickList ? t('sales.printKinds.PICK_LIST') : null,
                          stage.printDeliveryNote ? t('sales.printKinds.DELIVERY_NOTE') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <RowActions>
                      <RowAction
                        label={`${t('sales.boards.up')}: ${stage.name}`}
                        icon={ArrowUp}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      />
                      <RowAction
                        label={`${t('sales.boards.down')}: ${stage.name}`}
                        icon={ArrowDown}
                        disabled={index === stages.length - 1}
                        onClick={() => move(index, index + 1)}
                      />
                      <RowAction
                        label={`${t('common.edit')}: ${stage.name}`}
                        icon={Pencil}
                        onClick={() => setEditing(stage)}
                      />
                      <RowAction
                        label={`${t('sales.pipelines.removeStage')}: ${stage.name}`}
                        icon={Trash2}
                        destructive
                        disabled={stages.length === 1}
                        onClick={() =>
                          setStages((current) => current.filter((entry) => entry.key !== stage.key))
                        }
                      />
                    </RowActions>
                  </li>
                ))}
              </ol>
              <div>
                <Button variant="outline" onClick={() => setEditing('new')}>
                  <Plus />
                  {t('sales.boards.newStage')}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
          <ProblemAlert problem={action.problem} />
          <SheetFooter className="mt-auto flex-row justify-end gap-2">
            <Button variant="ghost" onClick={requestClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={pending || !name.trim() || board === null || stages.length === 0}
              onClick={save}
            >
              {pipeline ? t('common.save') : t('sales.pipelines.create')}
            </Button>
          </SheetFooter>
          <Dialog
            open={editing !== null}
            onOpenChange={(open) => (open ? undefined : setEditing(null))}
          >
            {editing !== null ? (
              <StageDialog
                actions={KIND_STAGE_ACTIONS[kind]}
                stage={editing === 'new' ? null : editing}
                onSave={(saved) => {
                  setStages((current) =>
                    editing === 'new'
                      ? [...current, { ...saved, key: randomUuid() }]
                      : current.map((entry) =>
                          entry.key === editing.key
                            ? { ...saved, id: entry.id, key: entry.key }
                            : entry,
                        ),
                  );
                  setEditing(null);
                }}
              />
            ) : null}
          </Dialog>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={leaving}
        title={t('sales.panel.leaveTitle')}
        description={t('sales.pipelines.leaveDescription')}
        confirmLabel={t('sales.panel.leave')}
        onConfirm={() => {
          setLeaving(false);
          onClose();
        }}
        onClose={() => setLeaving(false)}
      />
    </>
  );
}

function RolesField({
  right,
  hint,
  options,
  value,
  onChange,
}: {
  right: PipelineRight;
  hint?: string;
  options: ReturnType<typeof useRoleOptions>;
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t(`sales.pipelines.rights.${right}`)}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <CheckboxGroup
        name={`pipeline-${right.toLowerCase()}`}
        options={options}
        value={value}
        onChange={onChange}
      />
    </fieldset>
  );
}
