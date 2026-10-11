import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldError } from '@/components/field-error';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from '@/lib/use-action';
import { type CustomerAddress, type CustomerDetail, usePartnersMutations } from './api';
import { GpsField, MapLink } from './gps-field';
import { type AddressFormValues, addressBody, addressSchema, gpsText } from './partner-schema';

/**
 * Delivery addresses: the default one first, each with its GPS point and a map link (SPEC §5.3).
 * Addresses are archived, never deleted: orders keep a copy of the address they went to.
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
  const archiveAction = useAction();
  const [editing, setEditing] = useState<CustomerAddress | 'new' | null>(null);
  const [archiving, setArchiving] = useState<CustomerAddress | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.addresses.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
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
        {customer.addresses.map((address) => (
          <section
            key={address.id}
            aria-label={address.label ?? address.address ?? t('partners.addresses.title')}
            className="flex flex-col gap-1 rounded-lg border p-3"
          >
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
                <Badge variant="outline">{t('partners.addresses.noGps')}</Badge>
              </div>
            )}
            {address.note ? <p className="text-sm text-muted-foreground">{address.note}</p> : null}
            {canManage ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(address)}>
                  {t('common.edit')}
                </Button>
                {address.isDefault ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action.run(() => mutations.defaultAddress.mutateAsync(address.id))
                    }
                  >
                    {t('partners.addresses.makeDefault')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    archiveAction.clear();
                    setArchiving(address);
                  }}
                >
                  {t('partners.addresses.archive')}
                </Button>
              </div>
            ) : null}
          </section>
        ))}
      </CardContent>
      {editing ? (
        <AddressDialog
          customerId={customer.id}
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={archiving !== null}
        title={t('partners.addresses.archive')}
        description={t('partners.addresses.archiveConfirm')}
        confirmLabel={t('partners.addresses.archive')}
        pending={mutations.archiveAddress.isPending}
        problem={archiveAction.problem}
        onClose={() => setArchiving(null)}
        onConfirm={() => {
          if (!archiving) return;
          void archiveAction
            .run(() => mutations.archiveAddress.mutateAsync(archiving.id))
            .then((ok) => (ok ? setArchiving(null) : undefined));
        }}
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
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {address ? t('partners.addresses.edit') : t('partners.addresses.add')}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address-label">{t('partners.addresses.label')}</Label>
            <Input id="address-label" autoComplete="off" {...form.register('label')} />
            <FieldError message={errors.label?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address-text">{t('partners.addresses.address')}</Label>
            <Textarea id="address-text" rows={2} {...form.register('address')} />
            <FieldError message={errors.address?.message} />
          </div>
          <GpsField
            id="address-gps"
            value={form.watch('gps')}
            registration={form.register('gps')}
            error={errors.gps?.message}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="address-note">{t('partners.addresses.note')}</Label>
            <Input id="address-note" autoComplete="off" {...form.register('note')} />
            <FieldError message={errors.note?.message} />
          </div>
          {address ? null : (
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="address-default"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <Label htmlFor="address-default" className="font-normal">
                    {t('partners.addresses.makeDefault')}
                  </Label>
                </div>
              )}
            />
          )}
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
