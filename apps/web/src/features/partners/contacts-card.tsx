import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldError } from '@/components/field-error';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction } from '@/lib/use-action';
import type { Contact, ContactRequest } from './api';
import { type ContactFormValues, contactBody, contactSchema } from './partner-schema';
import { localPhone, phoneInput } from './phone';

/** The people to call at a customer or a supplier: name or phone, position, a note. */
export function ContactsCard(props: {
  contacts: readonly Contact[];
  canManage: boolean;
  onAdd: (body: ContactRequest) => Promise<unknown>;
  onUpdate: (id: number, body: ContactRequest) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const deleteAction = useAction();
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.contacts.title')}</CardTitle>
        {props.canManage ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
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
          <ul className="flex flex-col divide-y">
            {props.contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{contact.name ?? t('common.none')}</span>
                {contact.position ? (
                  <span className="text-sm text-muted-foreground">{contact.position}</span>
                ) : null}
                {contact.phone ? (
                  <a className="font-mono text-sm" href={`tel:${contact.phone}`}>
                    {localPhone(contact.phone)}
                  </a>
                ) : null}
                {contact.note ? (
                  <span className="basis-full text-sm text-muted-foreground">{contact.note}</span>
                ) : null}
                {props.canManage ? (
                  <span className="ml-auto flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(contact)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        deleteAction.clear();
                        setDeleting(contact);
                      }}
                    >
                      {t('common.delete')}
                    </Button>
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
        open={deleting !== null}
        title={t('common.delete')}
        description={t('partners.contacts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        pending={pending}
        problem={deleteAction.problem}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          setPending(true);
          void deleteAction
            .run(() => props.onDelete(deleting.id))
            .then((ok) => {
              setPending(false);
              if (ok) setDeleting(null);
            });
        }}
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
        <DialogHeader>
          <DialogTitle>
            {props.contact ? t('partners.contacts.edit') : t('partners.contacts.add')}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-name">{t('partners.contacts.name')}</Label>
              <Input id="contact-name" autoComplete="off" {...form.register('name')} />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-position">{t('partners.contacts.position')}</Label>
              <Input id="contact-position" autoComplete="off" {...form.register('position')} />
              <FieldError message={errors.position?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-phone">{t('partners.contacts.phone')}</Label>
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                {...form.register('phone')}
              />
              <FieldError message={errors.phone?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-note">{t('partners.contacts.note')}</Label>
              <Input id="contact-note" autoComplete="off" {...form.register('note')} />
              <FieldError message={errors.note?.message} />
            </div>
          </div>
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
