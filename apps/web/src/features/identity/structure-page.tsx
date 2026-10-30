import {
  Building2,
  KanbanSquare,
  KeyRound,
  Monitor,
  Pencil,
  Plus,
  Store,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { type EdgeNode, type Till, useCashiers, useEdgeNodes, useTills } from '@/features/pos/api';
import { NodeDialog, TillDialog } from '@/features/pos/tills-page';
import { type SalesBoard, useBoardTree } from '@/features/sales/pipelines-api';
import { BoardDialog } from '@/features/sales/settings-dialogs';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { type Branch, type Warehouse, useBranches, useWarehouses } from './api';
import { BranchDialog, WarehouseDialog } from './org-pages';

type Dialogs =
  | { kind: 'branch'; branch: Branch | 'new' }
  | {
      kind: 'warehouse';
      warehouse: Warehouse | 'new';
      preset?: { kind: 'WHOLESALE' | 'STORE'; branchId: number };
    }
  | { kind: 'node'; node: EdgeNode | null; warehouseId?: number }
  | { kind: 'till'; till: Till | null; node: EdgeNode }
  | { kind: 'board'; board: SalesBoard | null; branchId?: number }
  | null;

/**
 * «Байгууллагын бүтэц» (owner 2026-10-31): the one page a new installation is set up from, in the
 * order the data needs. One system is one branch (registered once, Kharkhorin is its own
 * installation, ADR-0084): its warehouses and supermarkets, each supermarket's one Edge (the
 * store server) and the Edge's POS (the tills, each selling on its own), the cashiers, and the
 * sales boards. Everything is
 * added or changed in place through the same dialogs the separate pages use; the separate pages
 * stay for the details (pairing, printers, PINs, pipelines).
 */
export function StructurePage() {
  const { t } = useTranslation();
  const canOrg = useHasPermission('identity.org.manage');
  const canPos = useHasPermission('pos.manage');
  const canReadPos = useHasPermission('pos.read');
  const canBoards = useHasPermission('sales.boards.manage');
  const branches = useBranches();
  const warehouses = useWarehouses();
  const nodes = useEdgeNodes(canReadPos);
  const tills = useTills(undefined, canReadPos);
  const cashiers = useCashiers(canReadPos);
  const boards = useBoardTree();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const close = () => setDialog(null);

  const branchList = branches.data ?? [];
  const warehouseList = warehouses.data ?? [];
  const nodeList = nodes.data ?? [];
  const tillList = tills.data ?? [];
  const boardList = boards.data ?? [];
  const stores = warehouseList.filter((warehouse) => warehouse.kind === 'STORE');
  const steps: {
    key: 'warehouses' | 'stores' | 'nodes' | 'tills' | 'cashiers' | 'boards';
    icon: typeof Building2;
    count: number;
  }[] = [
    {
      key: 'warehouses',
      icon: WarehouseIcon,
      count: warehouseList.filter((warehouse) => warehouse.kind === 'WHOLESALE').length,
    },
    { key: 'stores', icon: Store, count: stores.length },
    { key: 'nodes', icon: Monitor, count: nodeList.length },
    { key: 'tills', icon: Monitor, count: tillList.length },
    { key: 'cashiers', icon: KeyRound, count: cashiers.data?.length ?? 0 },
    { key: 'boards', icon: KanbanSquare, count: boardList.length },
  ];

  return (
    <div>
      <PageHeader
        title={t('org.structure.title')}
        description={t('org.structure.description')}
        actions={
          canOrg && !branches.isPending && branchList.length === 0 ? (
            <Button onClick={() => setDialog({ kind: 'branch', branch: 'new' })}>
              <Plus aria-hidden />
              {t('org.structure.addBranch')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(branches.error ?? warehouses.error)} />
      <ol
        className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
        aria-label={t('org.structure.steps')}
      >
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={cn(
                'flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 shadow-card ring-1 ring-black/[0.06]',
                step.count === 0 && 'text-muted-foreground',
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-[0.75rem] font-semibold">
                {index + 1}
              </span>
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                {t(`org.structure.step.${step.key}`)}
              </span>
              <span className="font-mono text-[0.8125rem] font-semibold">
                {formatCount(step.count)}
              </span>
            </li>
          );
        })}
      </ol>

      {branchList.length === 0 && !branches.isPending ? (
        <section className="rounded-xl bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-card ring-1 ring-black/[0.06]">
          {t('org.structure.noBranches')}
        </section>
      ) : null}

      <div className="flex flex-col gap-4">
        {branchList.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            warehouses={warehouseList.filter((warehouse) => warehouse.branchId === branch.id)}
            nodes={nodeList}
            tills={tillList}
            boards={boardList.filter((board) => board.branchId === branch.id)}
            canOrg={canOrg}
            canPos={canPos}
            canReadPos={canReadPos}
            canBoards={canBoards}
            onOpen={setDialog}
          />
        ))}
        {boardList.some((board) => board.branchId === null) ? (
          <Section
            icon={KanbanSquare}
            title={t('org.structure.boardsEveryBranch')}
            action={
              canBoards ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialog({ kind: 'board', board: null })}
                >
                  <Plus aria-hidden />
                  {t('org.structure.addBoard')}
                </Button>
              ) : null
            }
          >
            <BoardList
              boards={boardList.filter((board) => board.branchId === null)}
              canBoards={canBoards}
              onEdit={(board) => setDialog({ kind: 'board', board })}
            />
          </Section>
        ) : null}
        {canReadPos ? (
          <Section
            icon={KeyRound}
            title={t('org.structure.cashiersTitle')}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link to="/pos/cashiers">{t('org.structure.openCashiers')}</Link>
              </Button>
            }
          >
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('org.structure.cashiersHint', { count: formatCount(cashiers.data?.length ?? 0) })}
            </p>
          </Section>
        ) : null}
      </div>

      {dialog?.kind === 'branch' ? <BranchDialog branch={dialog.branch} onClose={close} /> : null}
      {dialog?.kind === 'warehouse' ? (
        <WarehouseDialog warehouse={dialog.warehouse} preset={dialog.preset} onClose={close} />
      ) : null}
      {dialog?.kind === 'node' ? (
        <NodeDialog
          open
          node={dialog.node}
          presetWarehouseId={dialog.warehouseId}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'till' ? (
        <TillDialog open till={dialog.till} nodes={[dialog.node]} onClose={close} />
      ) : null}
      <Dialog open={dialog?.kind === 'board'} onOpenChange={(open) => !open && close()}>
        {dialog?.kind === 'board' ? (
          <BoardDialog board={dialog.board} presetBranchId={dialog.branchId} onClose={close} />
        ) : null}
      </Dialog>
    </div>
  );
}

function BranchCard(props: {
  branch: Branch;
  warehouses: Warehouse[];
  nodes: EdgeNode[];
  tills: Till[];
  boards: SalesBoard[];
  canOrg: boolean;
  canPos: boolean;
  canReadPos: boolean;
  canBoards: boolean;
  onOpen: (dialog: Dialogs) => void;
}) {
  const { t } = useTranslation();
  const { branch } = props;
  const wholesale = props.warehouses.filter((warehouse) => warehouse.kind === 'WHOLESALE');
  const stores = props.warehouses.filter((warehouse) => warehouse.kind === 'STORE');
  return (
    <section
      aria-label={branch.name}
      className="rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/80 px-4 py-3">
        <Building2 aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-[1.0625rem] font-semibold">{branch.name}</h2>
        <span className="font-mono text-[0.8125rem] text-muted-foreground">{branch.code}</span>
        {branch.status !== 'ACTIVE' ? (
          <Badge variant="secondary">{t('org.status.INACTIVE')}</Badge>
        ) : null}
        {props.canOrg ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => props.onOpen({ kind: 'branch', branch })}
          >
            <Pencil aria-hidden />
            {t('common.edit')}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-3">
        <Section
          icon={WarehouseIcon}
          title={t('org.structure.warehouses')}
          flat
          action={
            props.canOrg ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  props.onOpen({
                    kind: 'warehouse',
                    warehouse: 'new',
                    preset: { kind: 'WHOLESALE', branchId: branch.id },
                  })
                }
              >
                <Plus aria-hidden />
                {t('org.structure.addWarehouse')}
              </Button>
            ) : null
          }
        >
          {wholesale.length === 0 ? (
            <Empty>{t('org.structure.noWarehouses')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-border/80">
              {wholesale.map((warehouse) => (
                <Row
                  key={warehouse.id}
                  name={warehouse.name}
                  code={warehouse.code}
                  inactive={warehouse.status !== 'ACTIVE'}
                  onEdit={
                    props.canOrg ? () => props.onOpen({ kind: 'warehouse', warehouse }) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={Store}
          title={t('org.structure.stores')}
          flat
          action={
            props.canOrg ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  props.onOpen({
                    kind: 'warehouse',
                    warehouse: 'new',
                    preset: { kind: 'STORE', branchId: branch.id },
                  })
                }
              >
                <Plus aria-hidden />
                {t('org.structure.addStore')}
              </Button>
            ) : null
          }
        >
          {stores.length === 0 ? (
            <Empty>{t('org.structure.noStores')}</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {stores.map((store) => (
                <li key={store.id} className="rounded-lg border border-border/80 p-3">
                  <Row
                    name={store.name}
                    code={store.code}
                    inactive={store.status !== 'ACTIVE'}
                    onEdit={
                      props.canOrg
                        ? () => props.onOpen({ kind: 'warehouse', warehouse: store })
                        : undefined
                    }
                  />
                  {props.canReadPos ? (
                    <StoreNodes
                      store={store}
                      nodes={props.nodes.filter((node) => node.warehouseId === store.id)}
                      tills={props.tills}
                      canPos={props.canPos}
                      onOpen={props.onOpen}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={KanbanSquare}
          title={t('org.structure.boards')}
          flat
          action={
            props.canBoards ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => props.onOpen({ kind: 'board', board: null, branchId: branch.id })}
              >
                <Plus aria-hidden />
                {t('org.structure.addBoard')}
              </Button>
            ) : null
          }
        >
          <BoardList
            boards={props.boards}
            canBoards={props.canBoards}
            onEdit={(board) => props.onOpen({ kind: 'board', board })}
          />
        </Section>
      </div>
    </section>
  );
}

/** A supermarket's POS (its store edge) and the tills of each. */
function StoreNodes(props: {
  store: Warehouse;
  nodes: EdgeNode[];
  tills: Till[];
  canPos: boolean;
  onOpen: (dialog: Dialogs) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border/80 pt-2">
      <div className="flex items-center gap-2">
        <Monitor aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="text-[0.8125rem] font-medium">{t('org.structure.nodes')}</span>
        {props.canPos && props.nodes.length === 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-link"
            onClick={() => props.onOpen({ kind: 'node', node: null, warehouseId: props.store.id })}
          >
            <Plus aria-hidden />
            {t('org.structure.addNode')}
          </Button>
        ) : null}
      </div>
      {props.nodes.length === 0 ? (
        <Empty>{t('org.structure.noNodes')}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.nodes.map((node) => {
            const tills = props.tills.filter((till) => till.edgeNodeId === node.id);
            return (
              <li key={node.id} className="rounded-md bg-fill/60 px-2.5 py-2">
                <Row
                  name={node.name}
                  code={node.code}
                  inactive={node.status !== 'ACTIVE'}
                  onEdit={props.canPos ? () => props.onOpen({ kind: 'node', node }) : undefined}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {tills.length === 0 ? (
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t('org.structure.noTills')}
                    </span>
                  ) : (
                    tills.map((till) => (
                      <Badge
                        key={till.id}
                        variant={till.status === 'ACTIVE' ? 'outline' : 'secondary'}
                        className="gap-1"
                        asChild={props.canPos}
                      >
                        {props.canPos ? (
                          <button
                            type="button"
                            aria-label={t('org.structure.editTill', { name: till.name })}
                            onClick={() => props.onOpen({ kind: 'till', till, node })}
                          >
                            <span className="font-mono">{till.code}</span>
                            {till.name}
                          </button>
                        ) : (
                          <>
                            <span className="font-mono">{till.code}</span>
                            {till.name}
                          </>
                        )}
                      </Badge>
                    ))
                  )}
                  {props.canPos ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-link"
                      onClick={() => props.onOpen({ kind: 'till', till: null, node })}
                    >
                      <Plus aria-hidden />
                      {t('org.structure.addTill')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BoardList(props: {
  boards: SalesBoard[];
  canBoards: boolean;
  onEdit: (board: SalesBoard) => void;
}) {
  const { t } = useTranslation();
  if (props.boards.length === 0) return <Empty>{t('org.structure.noBoards')}</Empty>;
  return (
    <ul className="flex flex-col divide-y divide-border/80">
      {props.boards.map((board) => (
        <Row
          key={board.id}
          name={board.name}
          detail={t('org.structure.pipelines', { count: formatCount(board.pipelines.length) })}
          inactive={board.archivedAt !== null}
          to={`/sales/boards/settings?board=${board.id}`}
          onEdit={props.canBoards ? () => props.onEdit(board) : undefined}
        />
      ))}
    </ul>
  );
}

function Section(props: {
  icon: typeof Building2;
  title: string;
  action?: ReactNode;
  flat?: boolean;
  children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section
      aria-label={props.title}
      className={cn(
        'flex flex-col gap-2',
        !props.flat && 'rounded-xl bg-card p-4 shadow-card ring-1 ring-black/[0.06]',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 className="text-[0.9375rem] font-semibold">{props.title}</h3>
        <span className="ml-auto">{props.action}</span>
      </div>
      {props.children}
    </section>
  );
}

function Row(props: {
  name: string;
  code?: string;
  detail?: string;
  inactive?: boolean;
  to?: string;
  onEdit?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li className={cn('flex items-center gap-2 py-1.5 text-sm', props.inactive && 'opacity-60')}>
      {props.code ? (
        <span className="font-mono text-[0.8125rem] text-muted-foreground">{props.code}</span>
      ) : null}
      {props.to ? (
        <Link to={props.to} className="min-w-0 flex-1 truncate underline-offset-4 hover:underline">
          {props.name}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate">{props.name}</span>
      )}
      {props.detail ? (
        <span className="text-[0.8125rem] text-muted-foreground">{props.detail}</span>
      ) : null}
      {props.onEdit ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={`${t('common.edit')}: ${props.name}`}
          onClick={props.onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[0.8125rem] text-muted-foreground">{children}</p>;
}
