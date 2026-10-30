import { Plus, Star, Unlink } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RowAction, RowActionSpacer } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { usePartnersMutations, useProductSuppliers, useSuppliers } from './api';

/**
 * The suppliers a product is ordered from, on the product page (ADR-0032): one main supplier,
 * others besides. Every user sees them (goods receipts); admins link, move and remove them.
 */
export function ProductSuppliersCard({ productId }: { productId: number }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.suppliers.manage');
  const links = useProductSuppliers(productId);
  const mutations = usePartnersMutations();
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const removing = useDeleteConfirm<{ id: number; supplier: { name: string } }>((id) =>
    mutations.unlinkSupplier.mutateAsync(id),
  );
  const rows = links.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.productSuppliers.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              {t('partners.productSuppliers.add')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProblemAlert problem={action.problem ?? problemFromError(links.error)} />
        {!links.isPending && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partners.productSuppliers.empty')}</p>
        ) : null}
        <ul className="flex flex-col divide-y">
          {rows.map((link) => (
            <li key={link.id} className="flex items-center gap-2 py-2">
              <span className="shrink-0 font-mono text-sm text-muted-foreground">
                {link.supplier.code}
              </span>
              <Link
                to={`/partners/suppliers/${link.supplier.id}`}
                className="min-w-0 flex-1 truncate font-medium underline-offset-4 hover:underline"
              >
                {link.supplier.name}
              </Link>
              {link.isMain ? (
                <Star
                  role="img"
                  aria-label={t('partners.productSuppliers.main')}
                  className="size-4 shrink-0 fill-warning text-warning"
                />
              ) : null}
              {link.supplier.status === 'ACTIVE' ? null : (
                <Badge variant="outline">{t(`partners.status.${link.supplier.status}`)}</Badge>
              )}
              {canManage ? (
                <span className="-my-1 ml-auto flex shrink-0 gap-0.5">
                  {link.isMain ? (
                    <RowActionSpacer />
                  ) : (
                    <RowAction
                      label={`${t('partners.productSuppliers.makeMain')}: ${link.supplier.name}`}
                      icon={Star}
                      onClick={() =>
                        void action.run(() => mutations.mainSupplier.mutateAsync(link.id))
                      }
                    />
                  )}
                  <RowAction
                    label={`${t('partners.productSuppliers.remove')}: ${link.supplier.name}`}
                    icon={Unlink}
                    destructive
                    onClick={() => removing.ask(link)}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={removing.target !== null}
        title={t('partners.productSuppliers.removeTitle', {
          name: removing.target?.supplier.name ?? '',
        })}
        description={t('partners.productSuppliers.removeDescription')}
        confirmLabel={t('partners.productSuppliers.remove')}
        pending={removing.pending}
        problem={removing.problem}
        onClose={removing.close}
        onConfirm={removing.confirm}
      />
      {adding ? (
        <LinkSupplierDialog
          productId={productId}
          linked={new Set(rows.map((link) => link.supplier.id))}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Card>
  );
}

/** Search active suppliers by name, code, phone or TIN and link one to the product. */
function LinkSupplierDialog(props: {
  productId: number;
  linked: ReadonlySet<number>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = usePartnersMutations();
  const action = useAction();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const suppliers = useSuppliers({ q, status: 'ACTIVE' });
  const rows = (suppliers.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (supplier) => !props.linked.has(supplier.id),
  );

  const link = async (supplierId: number) => {
    const ok = await action.run(() =>
      mutations.linkSupplier.mutateAsync({ productId: props.productId, supplierId }),
    );
    if (ok) props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{t('partners.productSuppliers.add')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(suppliers.error)} />
        <Input
          type="search"
          aria-label={t('partners.productSuppliers.search')}
          placeholder={t('partners.suppliers.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!suppliers.isPending && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('partners.productSuppliers.noResults')}
          </p>
        ) : null}
        <ul className="flex max-h-80 flex-col divide-y overflow-y-auto">
          {rows.map((supplier) => (
            <li key={supplier.id} className="flex items-center gap-2 py-2">
              <span className="font-mono text-sm text-muted-foreground">{supplier.code}</span>
              <span className="font-medium">{supplier.name}</span>
              <Button
                size="xs"
                variant="outline"
                className="ml-auto"
                aria-label={`${t('partners.productSuppliers.link')}: ${supplier.name}`}
                disabled={mutations.linkSupplier.isPending}
                onClick={() => void link(supplier.id)}
              >
                {t('partners.productSuppliers.link')}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
