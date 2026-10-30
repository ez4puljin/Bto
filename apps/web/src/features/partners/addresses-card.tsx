import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Pencil, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { RowAction, RowActionSpacer } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from '@/lib/use-action';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { type CustomerAddress, type CustomerDetail, usePartnersMutations } from './api';
import { GpsField, MapLink } from './gps-field';
import { type AddressFormValues, addressBody, addressSchema, gpsText } from './partner-schema';

/**
 * Delivery addresses: the default one first, each with its GPS point and a map link (SPEC §5.3).
 * Addresses are archived, never deleted: orders keep a copy of the address they went to. Each row
 * ends with its icon actions (ADR-0043); the form opens in a dialog.
 */
export function AddressesCard({
  customer,
  canManage,
}: {
  customer: CustomerDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const mutations = usePartnersMutations();
  const action = useAction();
  const [editing, setEditing] = useState<CustomerAddress | 'new' | null>(null);
  const archiving = useDeleteConfirm<CustomerAddress>((id) =>
    mutations.archiveAddress.mutateAsync(id),
  );
  const nameOf = (address: CustomerAddress) =>
    address.label ?? address.address ?? t('partners.addresses.title');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.addresses.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus />
              {t('partners.addresses.add')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        {customer.addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partners.addresses.empty')}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border/80">
          {customer.addresses.map((address) => (
            <li key={address.id}>
              <section aria-label={nameOf(address)} className="flex items-start gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {address.label ? <span className="font-medium">{address.label}</span> : null}
                    {address.isDefault ? (
                      <Badge variant="secondary">{t('partners.addresses.default')}</Badge>
                    ) : null}
                  </div>
                  {address.address ? <p className="text-sm">{address.address}</p> : null}
                  {address.lat && address.lng ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-muted-foreground">
                        {gpsText(address.lat, address.lng)}
                      </span>
                      {address.gpsSource ? (
                        <Badge variant="outline">
                          {t(`partners.addresses.gpsSource.${address.gpsSource}`)}
                        </Badge>
                      ) : null}
                      <MapLink lat={address.lat} lng={address.lng} />
                    </div>
                  ) : (
                    <div>
                      <Badge variant="warning">{t('partners.addresses.noGps')}</Badge>
                    </div>
                  )}
                  {address.note ? (
                    <p className="text-[0.8125rem] text-muted-foreground">{address.note}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <span className="-my-1 flex shrink-0 gap-0.5">
                    <RowAction
                      label={`${t('common.edit')}: ${nameOf(address)}`}
                      icon={Pencil}
                      onClick={() => setEditing(address)}
                    />
                    {address.isDefault ? (
                      <RowActionSpacer />
                    ) : (
                      <RowAction
                        label={`${t('partners.addresses.makeDefault')}: ${nameOf(address)}`}
                        icon={Star}
                        onClick={() =>
                          void action.run(() => mutations.defaultAddress.mutateAsync(address.id))
                        }
                      />
                    )}
                    <RowAction
                      label={`${t('partners.addresses.archive')}: ${nameOf(address)}`}
                      icon={Archive}
                      destructive
                      onClick={() => archiving.ask(address)}
                    />
                  </span>
                ) : null}
              </section>
            </li>
          ))}
        </ul>
      </CardContent>
      {editing ? (
        <AddressDialog
          customerId={customer.id}
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={archiving.target !== null}
        title={t('partners.addresses.archive')}
        description={t('partners.addresses.archiveConfirm')}
        confirmLabel={t('partners.addresses.archive')}
        pending={archiving.pending}
        problem={archiving.problem}
        onClose={archiving.close}
        onConfirm={archiving.confirm}
      />
    </Card>
  );
}

function AddressDialog(props: {
  customerId: number;
  address: CustomerAddress | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = usePartnersMutations();
  const action = useAction();
  const { address } = props;
  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: address?.label ?? '',
      address: address?.address ?? '',
      gps: address ? gpsText(address.lat, address.lng) : '',
      note: address?.note ?? '',
      isDefault: false,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const ok = await action.run(() =>
      address
        ? mutations.updateAddress.mutateAsync({ id: address.id, body: addressBody(values) })
        : mutations.addAddress.mutateAsync({
            customerId: props.customerId,
            body: { ...addressBody(values), isDefault: values.isDefault },
          }),
    );
    if (ok) props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {address ? t('partners.addresses.edit') : t('partners.addresses.add')}
            </DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('partners.addresses.label')}
            htmlFor="address-label"
            error={errors.label?.message}
          >
            <Input id="address-label" autoComplete="off" {...form.register('label')} />
          </FormField>
          <FormField
            label={t('partners.addresses.address')}
            htmlFor="address-text"
            error={errors.address?.message}
          >
            <Textarea id="address-text" rows={2} {...form.register('address')} />
          </FormField>
          <FormField
            label={t('partners.addresses.gps')}
            htmlFor="address-gps"
            error={errors.gps?.message}
          >
            <GpsField
              id="address-gps"
              value={form.watch('gps')}
              registration={form.register('gps')}
            />
          </FormField>
          <FormField
            label={t('partners.addresses.note')}
            htmlFor="address-note"
            error={errors.note?.message}
          >
            <Input id="address-note" autoComplete="off" {...form.register('note')} />
          </FormField>
          {address ? null : (
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="address-default">{t('partners.addresses.makeDefault')}</Label>
                  <Switch
                    id="address-default"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          )}
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
