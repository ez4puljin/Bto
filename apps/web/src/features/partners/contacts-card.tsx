import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { RowAction } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAction } from '@/lib/use-action';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import type { Contact, ContactRequest } from './api';
import { type ContactFormValues, contactBody, contactSchema } from './partner-schema';
import { localPhone, phoneInput } from './phone';

/**
 * The people to call at a customer or a supplier: name or phone, position, a note. Each row ends
 * with its icon actions (ADR-0043); the form opens in a dialog.
 */
export function ContactsCard(props: {
  contacts: readonly Contact[];
  canManage: boolean;
  onAdd: (body: ContactRequest) => Promise<unknown>;
  onUpdate: (id: number, body: ContactRequest) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const deletion = useDeleteConfirm<Contact>(props.onDelete);
  const nameOf = (contact: Contact) => contact.name ?? localPhone(contact.phone ?? '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.contacts.title')}</CardTitle>
        {props.canManage ? (
          <CardAction>
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus />
              {t('partners.contacts.add')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {props.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partners.contacts.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/80">
            {props.contacts.map((contact) => (
              <li key={contact.id} className="flex items-start gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-medium">{contact.name ?? t('common.none')}</span>
                  {contact.position ? (
                    <span className="text-[13px] text-muted-foreground">{contact.position}</span>
                  ) : null}
                  {contact.phone ? (
                    <a className="font-mono text-sm text-link" href={`tel:${contact.phone}`}>
                      {localPhone(contact.phone)}
                    </a>
                  ) : null}
                  {contact.note ? (
                    <span className="basis-full text-[13px] text-muted-foreground">
                      {contact.note}
                    </span>
                  ) : null}
                </div>
                {props.canManage ? (
                  <span className="-my-1 flex shrink-0 gap-0.5">
                    <RowAction
                      label={`${t('common.edit')}: ${nameOf(contact)}`}
                      icon={Pencil}
                      onClick={() => setEditing(contact)}
                    />
                    <RowAction
                      label={`${t('common.delete')}: ${nameOf(contact)}`}
                      icon={Trash2}
                      destructive
                      onClick={() => deletion.ask(contact)}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing ? (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
          onSave={(body) =>
            editing === 'new' ? props.onAdd(body) : props.onUpdate(editing.id, body)
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('common.delete')}
        description={t('partners.contacts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        pending={deletion.pending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </Card>
  );
}

function ContactDialog(props: {
  contact: Contact | null;
  onSave: (body: ContactRequest) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useAction();
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: props.contact?.name ?? '',
      position: props.contact?.position ?? '',
      phone: phoneInput(props.contact?.phone ?? null),
      note: props.contact?.note ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const ok = await action.run(() => props.onSave(contactBody(values)));
    if (ok) props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {props.contact ? t('partners.contacts.edit') : t('partners.contacts.add')}
            </DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('partners.contacts.name')}
            htmlFor="contact-name"
            error={errors.name?.message}
          >
            <Input id="contact-name" autoComplete="off" {...form.register('name')} />
          </FormField>
          <FormField
            label={t('partners.contacts.position')}
            htmlFor="contact-position"
            error={errors.position?.message}
          >
            <Input id="contact-position" autoComplete="off" {...form.register('position')} />
          </FormField>
          <FormField
            label={t('partners.contacts.phone')}
            htmlFor="contact-phone"
            error={errors.phone?.message}
          >
            <Input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              {...form.register('phone')}
            />
          </FormField>
          <FormField
            label={t('partners.contacts.note')}
            htmlFor="contact-note"
            error={errors.note?.message}
          >
            <Input id="contact-note" autoComplete="off" {...form.register('note')} />
          </FormField>
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
