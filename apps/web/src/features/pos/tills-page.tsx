import { KeyRound, Monitor, Pencil, Plus, QrCode } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, ListCard, RowAction, RowActions, SkeletonRows } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWarehouses } from '@/features/identity/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { type EdgeNode, type Till, useEdgeNodes, usePosMutations, useTills } from './api';
import { ActiveBadge } from './badges';
import { OneTimeCodeDialog } from './one-time-code-dialog';

/**
 * «Касс» (ADR-0063 #8): the store's edge servers with their tokens, and the tills with their
 * printers. A token or a pairing code is shown once.
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
  const [tokenFor, setTokenFor] = useState<EdgeNode | null>(null);
  const [shown, setShown] = useState<{ title: string; description: string; code: string } | null>(
    null,
  );
  const mutations = usePosMutations();
  const action = useAction();
  const nodeName = (id: number) => nodes.data?.find((node) => node.id === id)?.code ?? '';

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
    <div className="space-y-4">
      <PageHeader
        title={t('pos.tills.title')}
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setNewNode(true)}>
                <Plus />
                {t('pos.actions.newNode')}
              </Button>
              <Button onClick={() => setNewTill(true)}>
                <Plus />
                {t('pos.actions.newTill')}
              </Button>
            </>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(nodes.error ?? tills.error) ?? action.problem} />
      <Card>
        <CardHeader>
          <CardTitle>{t('pos.nodes.title')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('pos.nodes.description')}</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.fields.code')}</TableHead>
                <TableHead>{t('pos.fields.name')}</TableHead>
                <TableHead>{t('pos.fields.warehouse')}</TableHead>
                <TableHead>{t('pos.fields.tokenPrefix')}</TableHead>
                <TableHead>{t('pos.fields.lastSeen')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.backlog')}</TableHead>
                <TableHead>{t('pos.fields.status')}</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.isPending ? <SkeletonRows columns={8} rows={2} /> : null}
              {(nodes.data ?? []).map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-mono font-medium">{node.code}</TableCell>
                  <TableCell>{node.name}</TableCell>
                  <TableCell>{node.warehouseName ?? ''}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {node.tokenPrefix ? `${node.tokenPrefix}…` : t('pos.fields.none')}
                  </TableCell>
                  <TableCell className="font-mono">
                    {node.lastSeenAt
                      ? formatUbDateTime(Date.parse(node.lastSeenAt))
                      : t('pos.nodes.neverSeen')}
                  </TableCell>
                  <TableCell className="text-right font-mono">{node.backlog}</TableCell>
                  <TableCell>
                    <ActiveBadge status={node.status} />
                  </TableCell>
                  <RowActions>
                    {canManage ? (
                      <>
                        <RowAction
                          label={`${t('pos.actions.newToken')}: ${node.code}`}
                          icon={KeyRound}
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
          </Table>
          {!nodes.isPending && (nodes.data ?? []).length === 0 ? (
            <EmptyState icon={Monitor} title={t('pos.nodes.empty')} />
          ) : null}
        </CardContent>
      </Card>
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.code')}</TableHead>
              <TableHead>{t('pos.fields.name')}</TableHead>
              <TableHead>{t('pos.fields.node')}</TableHead>
              <TableHead>{t('pos.fields.printer')}</TableHead>
              <TableHead>{t('pos.tills.lastSale')}</TableHead>
              <TableHead>{t('pos.fields.status')}</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tills.isPending ? <SkeletonRows columns={7} /> : null}
            {(tills.data ?? []).map((till) => (
              <TableRow key={till.id}>
                <TableCell className="font-mono font-medium">{till.code}</TableCell>
                <TableCell>{till.name}</TableCell>
                <TableCell className="font-mono">{nodeName(till.edgeNodeId)}</TableCell>
                <TableCell className="font-mono">
                  {till.printerHost
                    ? `${till.printerHost}:${till.printerPort}`
                    : t('pos.tills.noPrinter')}
                </TableCell>
                <TableCell className="font-mono">
                  {till.lastSaleAt ? formatUbDateTime(Date.parse(till.lastSaleAt)) : ''}
                </TableCell>
                <TableCell>
                  <ActiveBadge status={till.status} />
                </TableCell>
                <RowActions>
                  {canManage ? (
                    <>
                      <RowAction
                        label={`${t('pos.actions.pairingCode')}: ${till.code}`}
                        icon={QrCode}
                        onClick={() => pairingCode(till)}
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
        </Table>
        {!tills.isPending && (tills.data ?? []).length === 0 ? (
          <EmptyState icon={Monitor} title={t('pos.tills.empty')} />
        ) : null}
      </ListCard>
      <NodeDialog
        open={newNode || editingNode !== null}
        node={editingNode}
        onClose={() => {
          if (editingNode) setEditingNode(null);
          else setNewNode(false);
        }}
      />
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
        variant="default"
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

function NodeDialog({
  open,
  node,
  onClose,
}: {
  open: boolean;
  node: EdgeNode | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <NodeForm node={node} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function NodeForm({ node, onClose }: { node: EdgeNode | null; onClose: () => void }) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const mutations = usePosMutations();
  const action = useAction();
  const [code, setCode] = useState(node?.code ?? '');
  const [name, setName] = useState(node?.name ?? '');
  const [warehouseId, setWarehouseId] = useState<number | null>(node?.warehouseId ?? null);
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
          <FormField label={t('pos.fields.status')} htmlFor="node-status">
            <NativeSelect
              id="node-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
              }
            >
              <option value="ACTIVE">{t('pos.statuses.ACTIVE')}</option>
              <option value="INACTIVE">{t('pos.statuses.INACTIVE')}</option>
            </NativeSelect>
          </FormField>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}

function TillDialog({
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
  const [code, setCode] = useState(till?.code ?? '');
  const [name, setName] = useState(till?.name ?? '');
  const [printerHost, setPrinterHost] = useState(till?.printerHost ?? '');
  const [printerPort, setPrinterPort] = useState(String(till?.printerPort ?? 9100));
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
            printerHost: printerHost.trim() || null,
            printerPort: port,
            drawerKick,
            status,
          });
          toast.success(t('pos.tills.saved'));
        } else {
          await mutations.createTill.mutateAsync({
            edgeNodeId: edgeNodeId ?? 0,
            code: code.trim(),
            name: name.trim(),
            printerHost: printerHost.trim() || null,
            printerPort: port,
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
    <DialogContent closeLabel={t('common.close')}>
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
              <option value="">{t('pos.settings.chooseWarehouse')}</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.code} · {node.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
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
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={drawerKick} onCheckedChange={setDrawerKick} id="till-drawer" />
          <Label htmlFor="till-drawer">{t('pos.fields.drawerKick')}</Label>
        </label>
        {till ? (
          <FormField label={t('pos.fields.status')} htmlFor="till-status">
            <NativeSelect
              id="till-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
              }
            >
              <option value="ACTIVE">{t('pos.statuses.ACTIVE')}</option>
              <option value="INACTIVE">{t('pos.statuses.INACTIVE')}</option>
            </NativeSelect>
          </FormField>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter pending={pending} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}
