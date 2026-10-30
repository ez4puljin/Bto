import { KeyRound, Monitor, Pencil, Plus, QrCode, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TillAccessDialog } from './till-access-dialog';
import { useWarehouses } from '@/features/identity/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { type EdgeNode, type Till, useEdgeNodes, usePosMutations, useTills } from './api';
import { ActiveBadge } from './badges';
import { OneTimeCodeDialog } from './one-time-code-dialog';

/** The tills' columns (ADR-0119); the printer is `host:port`. */
const TILL_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'node', kind: 'code' },
  { key: 'printer', kind: 'number', width: 12 },
  { key: 'lastSale', kind: 'datetime' },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

/** The edge servers' columns; the PosAPI facts are two or three short lines. */
const NODE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'warehouse', kind: 'text', weight: 2 },
  { key: 'tokenPrefix', kind: 'code' },
  { key: 'lastSeen', kind: 'datetime' },
  { key: 'backlog', kind: 'count' },
  { key: 'posapi', kind: 'text', weight: 2, min: 12 },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

/**
 * «Касс» (ADR-0063 #8): the tills with their printers first (the page's main object), then the
 * store's edge servers with their tokens. A token or a pairing code is shown once; a new token stops
 * the old one at once, so it is asked as a destructive step (ADR-0066).
 */
export function PosTillsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const nodes = useEdgeNodes();
  const tills = useTills();
  const [newTill, setNewTill] = useCreateParam();
  const [newNode, setNewNode] = useCreateParam('node');
  const [editingNode, setEditingNode] = useState<EdgeNode | null>(null);
  const [editingTill, setEditingTill] = useState<Till | null>(null);
  const [accessTill, setAccessTill] = useState<Till | null>(null);
  const [tokenFor, setTokenFor] = useState<EdgeNode | null>(null);
  const [shown, setShown] = useState<{ title: string; description: string; code: string } | null>(
    null,
  );
  const mutations = usePosMutations();
  const action = useAction();
  const nodeName = (id: number) => nodes.data?.find((node) => node.id === id)?.code ?? '';
  const none = <span className="text-muted-foreground">{t('pos.fields.none')}</span>;

  const issueToken = (node: EdgeNode) => {
    void action
      .run(async () => {
        const issued = await mutations.issueToken.mutateAsync(node.id);
        setShown({
          title: t('pos.nodes.tokenTitle'),
          description: t('pos.nodes.tokenDescription', { name: node.name }),
          code: issued.token,
        });
      })
      .then((ok) => {
        if (ok) setTokenFor(null);
      });
  };
  // «3 кассчин · 1 хянагч · 2 ангилал», or «бүгд» for a till without lists (ADR-0124).
  const accessSummary = (till: Till): string => {
    const parts: string[] = [];
    if (till.cashierUserIds.length) {
      parts.push(t('pos.tills.access.cashierCount', { count: till.cashierUserIds.length }));
    }
    if (till.supervisorUserIds.length) {
      parts.push(t('pos.tills.access.supervisorCount', { count: till.supervisorUserIds.length }));
    }
    if (till.categoryIds.length) {
      parts.push(t('pos.tills.access.categoryCount', { count: till.categoryIds.length }));
    }
    return parts.length ? parts.join(' · ') : t('pos.tills.access.everything');
  };
  const pairingCode = (till: Till) => {
    void action.run(async () => {
      const issued = await mutations.pairingCode.mutateAsync(till.id);
      setShown({
        title: t('pos.tills.pairingTitle'),
        description: t('pos.tills.pairingDescription', {
          code: till.code,
          time: formatUbDateTime(Date.parse(issued.expiresAt)),
        }),
        code: issued.code,
      });
    });
  };

  return (
    <div>
      <PageHeader
        title={t('pos.tills.title')}
        actions={
          canManage ? (
            <Button onClick={() => setNewTill(true)}>
              <Plus />
              {t('pos.actions.newTill')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(nodes.error ?? tills.error) ?? action.problem} />
      <section aria-labelledby="pos-tills-heading" className="mb-6">
        <SectionHeading
          id="pos-tills-heading"
          title={t('pos.tills.listTitle')}
          description={t('pos.tills.description')}
        />
        <ListCard scroll>
          <ListTable columns={TILL_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.fields.code')}</TableHead>
                <TableHead>{t('pos.fields.name')}</TableHead>
                <TableHead>{t('pos.fields.node')}</TableHead>
                <TableHead>{t('pos.fields.warehouse')}</TableHead>
                <TableHead>{t('pos.tills.access.column')}</TableHead>
                <TableHead>{t('pos.fields.printer')}</TableHead>
                <TableHead>{t('pos.tills.lastSale')}</TableHead>
                <TableHead>{t('pos.fields.status')}</TableHead>
                <SpacerHead />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tills.isPending ? <SkeletonRows columns={8} rows={2} /> : null}
              {(tills.data ?? []).map((till) => (
                <TableRow key={till.id}>
                  <TableCell className="font-mono font-medium">{till.code}</TableCell>
                  <TruncateCell text={till.name} />
                  <TableCell className="font-mono">{nodeName(till.edgeNodeId)}</TableCell>
                  <TableCell>{till.warehouseName ?? none}</TableCell>
                  <TableCell className="text-[0.8125rem] text-muted-foreground">
                    {accessSummary(till)}
                  </TableCell>
                  <TableCell className="font-mono">
                    {till.printerHost ? (
                      `${till.printerHost}:${till.printerPort}`
                    ) : (
                      <span className="font-sans text-muted-foreground">
                        {t('pos.tills.noPrinter')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {till.lastSaleAt ? formatUbDateTime(Date.parse(till.lastSaleAt)) : none}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge status={till.status} />
                  </TableCell>
                  <SpacerCell />
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={`${t('pos.actions.pairingCode')}: ${till.code}`}
                          icon={QrCode}
                          onClick={() => pairingCode(till)}
                        />
                        <RowAction
                          label={`${t('pos.tills.access.action')}: ${till.code}`}
                          icon={ShieldCheck}
                          onClick={() => setAccessTill(till)}
                        />
                        <RowAction
                          label={`${t('pos.actions.edit')}: ${till.code}`}
                          icon={Pencil}
                          onClick={() => setEditingTill(till)}
                        />
                      </>
                    ) : null}
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </ListTable>
          {!tills.isPending && (tills.data ?? []).length === 0 ? (
            <EmptyState icon={Monitor} title={t('pos.tills.empty')} />
          ) : null}
        </ListCard>
      </section>
      <section aria-labelledby="pos-nodes-heading">
        <SectionHeading
          id="pos-nodes-heading"
          title={t('pos.nodes.title')}
          description={t('pos.nodes.description')}
          action={
            canManage ? (
              <Button variant="outline" size="sm" onClick={() => setNewNode(true)}>
                <Plus />
                {t('pos.actions.newNode')}
              </Button>
            ) : null
          }
        />
        <ListCard>
          <ListTable columns={NODE_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.fields.code')}</TableHead>
                <TableHead>{t('pos.fields.name')}</TableHead>
                <TableHead>{t('pos.fields.warehouse')}</TableHead>
                <TableHead>{t('pos.fields.tokenPrefix')}</TableHead>
                <TableHead>{t('pos.fields.lastSeen')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.backlog')}</TableHead>
                <TableHead>{t('pos.fields.posapi')}</TableHead>
                <TableHead>{t('pos.fields.status')}</TableHead>
                <SpacerHead />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.isPending ? <SkeletonRows columns={10} rows={2} /> : null}
              {(nodes.data ?? []).map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-mono font-medium">{node.code}</TableCell>
                  <TruncateCell text={node.name} />
                  <TableCell>{node.warehouseName ?? none}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {node.tokenPrefix ? `${node.tokenPrefix}…` : t('pos.fields.none')}
                  </TableCell>
                  <TableCell className="font-mono">
                    {node.lastSeenAt ? (
                      formatUbDateTime(Date.parse(node.lastSeenAt))
                    ) : (
                      <span className="font-sans text-muted-foreground">
                        {t('pos.nodes.neverSeen')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCount(node.backlog)}
                  </TableCell>
                  <TableCell>
                    <PosapiFacts node={node} />
                  </TableCell>
                  <TableCell>
                    <ActiveBadge status={node.status} />
                  </TableCell>
                  <SpacerCell />
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={`${t('pos.actions.newToken')}: ${node.code}`}
                          icon={KeyRound}
                          destructive
                          onClick={() => setTokenFor(node)}
                        />
                        <RowAction
                          label={`${t('pos.actions.edit')}: ${node.code}`}
                          icon={Pencil}
                          onClick={() => setEditingNode(node)}
                        />
                      </>
                    ) : null}
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </ListTable>
          {!nodes.isPending && (nodes.data ?? []).length === 0 ? (
            <EmptyState icon={Monitor} title={t('pos.nodes.empty')} />
          ) : null}
        </ListCard>
      </section>
      <NodeDialog
        open={newNode || editingNode !== null}
        node={editingNode}
        onClose={() => {
          if (editingNode) setEditingNode(null);
          else setNewNode(false);
        }}
      />
      {accessTill ? (
        <TillAccessDialog till={accessTill} onClose={() => setAccessTill(null)} />
      ) : null}
      <TillDialog
        open={newTill || editingTill !== null}
        till={editingTill}
        nodes={nodes.data ?? []}
        onClose={() => {
          if (editingTill) setEditingTill(null);
          else setNewTill(false);
        }}
      />
      <ConfirmDialog
        open={tokenFor !== null}
        title={t('pos.nodes.tokenTitle')}
        description={t('pos.nodes.tokenConfirm')}
        confirmLabel={t('pos.actions.newToken')}
        variant="destructive"
        pending={mutations.issueToken.isPending}
        problem={action.problem}
        onConfirm={() => {
          if (tokenFor) issueToken(tokenFor);
        }}
        onClose={() => setTokenFor(null)}
      />
      <OneTimeCodeDialog
        open={shown !== null}
        title={shown?.title ?? ''}
        description={shown?.description ?? ''}
        code={shown?.code ?? ''}
        onClose={() => setShown(null)}
      />
    </div>
  );
}

/** A list's title and what it holds, above its card; `action` adds to it. */
function SectionHeading(props: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
      <div className="min-w-0">
        <h2 id={props.id} className="text-[0.9375rem] font-semibold tracking-tight">
          {props.title}
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">{props.description}</p>
      </div>
      {props.action}
    </div>
  );
}

/** An on/off value of a dialog's form, with its state in words beside the switch. */
function SwitchRow(props: {
  id: string;
  label: string;
  checked: boolean;
  state?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <Label htmlFor={props.id} className="font-normal">
        {props.label}
      </Label>
      <div className="flex items-center gap-2.5">
        {props.state ? (
          <span className="text-[0.8125rem] text-muted-foreground">{props.state}</span>
        ) : null}
        <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
      </div>
    </div>
  );
}

export function NodeDialog({
  open,
  node,
  presetWarehouseId,
  onClose,
}: {
  open: boolean;
  node: EdgeNode | null;
  /** The supermarket a new POS belongs to, chosen by the structure page's button. */
  presetWarehouseId?: number | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <NodeForm node={node} presetWarehouseId={presetWarehouseId} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function NodeForm({
  node,
  presetWarehouseId,
  onClose,
}: {
  node: EdgeNode | null;
  presetWarehouseId?: number | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const mutations = usePosMutations();
  const action = useAction();
  const [code, setCode] = useState(node?.code ?? '');
  const [name, setName] = useState(node?.name ?? '');
  const [warehouseId, setWarehouseId] = useState<number | null>(
    node?.warehouseId ?? presetWarehouseId ?? null,
  );
  const [status, setStatus] = useState<EdgeNode['status']>(node?.status ?? 'ACTIVE');
  const [checked, setChecked] = useState(false);
  const stores = (warehouses.data ?? []).filter((warehouse) => warehouse.kind === 'STORE');
  const codeOk = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(code.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!name.trim() || warehouseId === null || (!node && !codeOk)) return;
    void action
      .run(async () => {
        if (node) {
          await mutations.updateNode.mutateAsync({
            id: node.id,
            name: name.trim(),
            warehouseId,
            status,
          });
          toast.success(t('pos.nodes.saved'));
        } else {
          await mutations.createNode.mutateAsync({
            code: code.trim(),
            name: name.trim(),
            warehouseId,
          });
          toast.success(t('pos.nodes.created'));
        }
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  const pending = mutations.createNode.isPending || mutations.updateNode.isPending;

  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{node ? t('pos.nodes.editTitle') : t('pos.nodes.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('pos.nodes.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          label={t('pos.fields.code')}
          htmlFor="node-code"
          hint={t('pos.nodes.codeHint')}
          error={checked && !node && !codeOk ? 'validation.code' : undefined}
        >
          <Input
            id="node-code"
            className="font-mono uppercase"
            value={code}
            disabled={node !== null}
            maxLength={16}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </FormField>
        <FormField
          label={t('pos.fields.name')}
          htmlFor="node-name"
          error={checked && !name.trim() ? 'validation.required' : undefined}
        >
          <Input
            id="node-name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('pos.fields.warehouse')}
          htmlFor="node-warehouse"
          hint={t('pos.settings.storeHint')}
          error={checked && warehouseId === null ? 'validation.required' : undefined}
        >
          <NativeSelect
            id="node-warehouse"
            value={warehouseId ?? ''}
            onChange={(event) => setWarehouseId(Number.parseInt(event.target.value, 10) || null)}
          >
            <option value="">{t('pos.settings.chooseWarehouse')}</option>
            {stores.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {node ? (
          <div className="overflow-hidden rounded-xl border border-border/90">
            <SwitchRow
              id="node-status"
              label={t('pos.fields.status')}
              checked={status === 'ACTIVE'}
              state={t(`pos.statuses.${status}`)}
              onChange={(on) => setStatus(on ? 'ACTIVE' : 'INACTIVE')}
            />
          </div>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}

export function TillDialog({
  open,
  till,
  nodes,
  onClose,
}: {
  open: boolean;
  till: Till | null;
  nodes: EdgeNode[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <TillForm till={till} nodes={nodes} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function TillForm({
  till,
  nodes,
  onClose,
}: {
  till: Till | null;
  nodes: EdgeNode[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = usePosMutations();
  const action = useAction();
  const [edgeNodeId, setEdgeNodeId] = useState<number | null>(
    till?.edgeNodeId ?? nodes[0]?.id ?? null,
  );
  // ADR-0123: the STORE warehouse the till sells from; the edge's unless another is picked.
  const warehouses = useWarehouses();
  const stores = (warehouses.data ?? []).filter((warehouse) => warehouse.kind === 'STORE');
  const [warehouseId, setWarehouseId] = useState<number | null>(till?.warehouseId ?? null);
  const edgeWarehouseId = nodes.find((node) => node.id === edgeNodeId)?.warehouseId ?? null;
  const chosenWarehouseId = warehouseId ?? edgeWarehouseId;
  const [code, setCode] = useState(till?.code ?? '');
  const [name, setName] = useState(till?.name ?? '');
  const [printerHost, setPrinterHost] = useState(till?.printerHost ?? '');
  const [printerPort, setPrinterPort] = useState(String(till?.printerPort ?? 9100));
  const [printerName, setPrinterName] = useState(till?.printerName ?? '');
  const [drawerKick, setDrawerKick] = useState(till?.drawerKick ?? true);
  const [status, setStatus] = useState<Till['status']>(till?.status ?? 'ACTIVE');
  const [checked, setChecked] = useState(false);
  // The dialog may open before the nodes arrive (?new=1): take the first one then.
  useEffect(() => {
    if (edgeNodeId === null && nodes[0]) setEdgeNodeId(nodes[0].id);
  }, [nodes, edgeNodeId]);
  const port = Number.parseInt(printerPort, 10);
  const portOk = Number.isInteger(port) && port >= 1 && port <= 65_535;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!name.trim() || !portOk || (!till && (!code.trim() || edgeNodeId === null))) return;
    void action
      .run(async () => {
        if (till) {
          await mutations.updateTill.mutateAsync({
            id: till.id,
            name: name.trim(),
            ...(chosenWarehouseId === null ? {} : { warehouseId: chosenWarehouseId }),
            printerHost: printerHost.trim() || null,
            printerPort: port,
            printerName: printerName.trim() || null,
            drawerKick,
            status,
          });
          toast.success(t('pos.tills.saved'));
        } else {
          await mutations.createTill.mutateAsync({
            edgeNodeId: edgeNodeId ?? 0,
            ...(chosenWarehouseId === null ? {} : { warehouseId: chosenWarehouseId }),
            code: code.trim(),
            name: name.trim(),
            printerHost: printerHost.trim() || null,
            printerPort: port,
            printerName: printerName.trim() || null,
            drawerKick,
          });
          toast.success(t('pos.tills.created'));
        }
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  const pending = mutations.createTill.isPending || mutations.updateTill.isPending;

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <DialogHeader>
        <DialogTitle>
          {till ? t('pos.tills.editTitle', { code: till.code }) : t('pos.tills.dialogTitle')}
        </DialogTitle>
        <DialogDescription>{t('pos.tills.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {till ? null : (
          <FormField
            label={t('pos.fields.node')}
            htmlFor="till-node"
            error={checked && edgeNodeId === null ? 'validation.required' : undefined}
          >
            <NativeSelect
              id="till-node"
              value={edgeNodeId ?? ''}
              onChange={(event) => setEdgeNodeId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('pos.tills.chooseNode')}</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.code} · {node.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField
          label={t('pos.fields.warehouse')}
          htmlFor="till-warehouse"
          hint={t('pos.tills.warehouseHint')}
        >
          <NativeSelect
            id="till-warehouse"
            value={chosenWarehouseId ?? ''}
            onChange={(event) => setWarehouseId(Number.parseInt(event.target.value, 10) || null)}
          >
            {stores.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
                {warehouse.id === edgeWarehouseId ? ` · ${t('pos.tills.edgeWarehouse')}` : ''}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <FormField
            label={t('pos.fields.code')}
            htmlFor="till-code"
            error={checked && !till && !code.trim() ? 'validation.required' : undefined}
          >
            <Input
              id="till-code"
              className="font-mono"
              value={code}
              disabled={till !== null}
              maxLength={8}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </FormField>
          <FormField
            label={t('pos.fields.name')}
            htmlFor="till-name"
            error={checked && !name.trim() ? 'validation.required' : undefined}
          >
            <Input
              id="till-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
        </div>
        <FormField
          label={t('pos.fields.printerName')}
          htmlFor="till-printer-name"
          hint={t('pos.tills.printerNameHint')}
        >
          <Input
            id="till-printer-name"
            value={printerName}
            maxLength={120}
            onChange={(event) => setPrinterName(event.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <FormField label={t('pos.fields.printerHost')} htmlFor="till-printer">
            <Input
              id="till-printer"
              className="font-mono"
              value={printerHost}
              maxLength={253}
              onChange={(event) => setPrinterHost(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('pos.fields.printerPort')}
            htmlFor="till-port"
            error={checked && !portOk ? 'validation.integerRange' : undefined}
          >
            <Input
              id="till-port"
              inputMode="numeric"
              className="font-mono"
              value={printerPort}
              onChange={(event) => setPrinterPort(event.target.value.trim())}
            />
          </FormField>
        </div>
        <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/90">
          <SwitchRow
            id="till-drawer"
            label={t('pos.fields.drawerKick')}
            checked={drawerKick}
            onChange={setDrawerKick}
          />
          {till ? (
            <SwitchRow
              id="till-status"
              label={t('pos.fields.status')}
              checked={status === 'ACTIVE'}
              state={t(`pos.statuses.${status}`)}
              onChange={(on) => setStatus(on ? 'ACTIVE' : 'INACTIVE')}
            />
          ) : null}
        </div>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}

/** The lotteries PosAPI has left below this are a warning (ADR-0065). */
const FEW_LOTTERIES = 500;
const SEND_LATE_MS = 24 * 3_600_000;

/**
 * The store PosAPI as the edge last reported it (ADR-0065): when it last sent its receipts to the
 * tax office and how many lotteries it has left; a warning after a day without sending.
 */
function PosapiFacts({ node }: { node: EdgeNode }) {
  const { t } = useTranslation();
  if (!node.posapiCheckedAt) {
    return <span className="text-muted-foreground">{t('pos.fields.none')}</span>;
  }
  const sent = node.posapiLastSent
    ? Date.parse(node.posapiLastSent.replace(' ', 'T') + '+08:00')
    : NaN;
  const late = Number.isNaN(sent) || Date.now() - sent > SEND_LATE_MS;
  const few = node.posapiLeftLotteries !== null && node.posapiLeftLotteries < FEW_LOTTERIES;
  return (
    <div className="text-xs leading-snug">
      {node.posapiError ? <p className="text-warning">{node.posapiError}</p> : null}
      <p className={late ? 'font-medium text-warning' : undefined}>
        {t('pos.fields.posapiLastSent')}:{' '}
        <span className="font-mono">{node.posapiLastSent ?? '—'}</span>
      </p>
      <p className={few ? 'font-medium text-warning' : 'text-muted-foreground'}>
        {t('pos.fields.posapiLotteries')}:{' '}
        <span className="font-mono">{node.posapiLeftLotteries ?? '—'}</span>
      </p>
    </div>
  );
}
