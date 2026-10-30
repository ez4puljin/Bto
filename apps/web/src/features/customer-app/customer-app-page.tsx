import { zodResolver } from '@hookform/resolvers/zod';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { RowAction, RowActions } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { localPhone, phoneInput } from '@/features/partners/phone';
import {
  type CompanyContact,
  type CompanyContactRequest,
  CONTACT_LIMITS,
  useBanners,
  useCompanyContacts,
  useCustomerAppAttention,
  useSaveCompanyContacts,
} from './api';

const requestOf = (contact: CompanyContact): CompanyContactRequest => ({
  role: contact.role,
  name: contact.name,
  phone: contact.phone,
  shown: contact.shown,
});

/**
 * «Систем» → «Харилцагчийн апп» (ADR-0079 #14, identity.settings.read or customer.home.manage):
 * the company's contact people every store sees on the app's «Профайл» (ADR-0092 #8) — role, name,
 * phone, shown or hidden, in order; each change saves the whole list (identity.settings.manage).
 * Beside it, for the home's keepers, the banners (ADR-0092 #5), and for people who set up the
 * boards, whether app orders have a stage to land on (ADR-0079 #5).
 */
export function CustomerAppPage() {
  const { t } = useTranslation();
  const canBoards = useHasPermission('sales.boards.manage');
  const canContacts = useHasPermission('identity.settings.read');
  const canHome = useHasPermission('customer.home.manage');
  return (
    <div className="space-y-4">
      <PageHeader title={t('customerApp.title')} description={t('customerApp.description')} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {canContacts ? <ContactsCard /> : null}
        {canHome || canBoards ? (
          <div className="flex flex-col gap-4">
            {canHome ? <BannersCard /> : null}
            {canBoards ? <OrdersCard /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** «Баннер» (ADR-0092 #5): how many banners the app shows now, and their page. */
function BannersCard() {
  const { t } = useTranslation();
  const banners = useBanners();
  const running = (banners.data ?? []).filter((banner) => banner.state === 'RUNNING').length;
  return (
    <Card role="region" aria-label={t('customerApp.banners.title')}>
      <CardHeader>
        <CardTitle>{t('customerApp.banners.title')}</CardTitle>
        <CardDescription>{t('customerApp.banners.cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(banners.error)} onRetry={banners.refetch} />
        {banners.isSuccess ? (
          <p className="text-sm">
            {t('customerApp.banners.runningCount', { n: formatCount(running) })}
          </p>
        ) : null}
        <Button asChild variant="link" size="sm" className="self-start px-0">
          <Link to="/system/customer-app/banners">
            {t('customerApp.banners.manage')}
            <ChevronRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ContactsCard() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.settings.manage');
  const contacts = useCompanyContacts();
  const save = useSaveCompanyContacts();
  const action = useAction();
  const [editing, setEditing] = useState<CompanyContact | 'new' | null>(null);
  const rows = contacts.data ?? [];
  const full = rows.length >= CONTACT_LIMITS.maxContacts;

  /** Saves the list as `next` says, in its order. */
  const store = async (next: CompanyContactRequest[]) => {
    await save.mutateAsync(next);
    toast.success(t('customerApp.contacts.saved'));
  };
  const deletion = useDeleteConfirm<CompanyContact>((id) =>
    store(rows.filter((row) => row.id !== id).map(requestOf)),
  );
  const move = (index: number, by: -1 | 1) => {
    const next = rows.map(requestOf);
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(index + by, 0, moved);
    void action.run(() => store(next));
  };
  const saveRow = (values: CompanyContactRequest) => {
    const target = editing;
    if (target === null) return Promise.resolve();
    return store(
      target === 'new'
        ? [...rows.map(requestOf), values]
        : rows.map((row) => (row.id === target.id ? values : requestOf(row))),
    );
  };

  return (
    <Card role="region" aria-label={t('customerApp.contacts.title')}>
      <CardHeader>
        <CardTitle>{t('customerApp.contacts.title')}</CardTitle>
        <CardDescription>
          {full ? t('customerApp.contacts.full') : t('customerApp.contacts.description')}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button
              size="sm"
              variant="secondary"
              disabled={!contacts.isSuccess || full}
              onClick={() => setEditing('new')}
            >
              <Plus />
              {t('customerApp.contacts.add')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      {/* The table runs to the card's edges, so its first column lines up with the title. */}
      <CardContent className={rows.length ? 'flex flex-col gap-3 px-0' : 'flex flex-col gap-3'}>
        <ProblemAlert problem={problemFromError(contacts.error)} onRetry={contacts.refetch} />
        <ProblemAlert problem={action.problem} />
        {contacts.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {contacts.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('customerApp.contacts.empty')}</p>
        ) : null}
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('customerApp.contacts.role')}</TableHead>
                <TableHead>{t('customerApp.contacts.name')}</TableHead>
                <TableHead>{t('customerApp.contacts.phone')}</TableHead>
                <TableHead>{t('customerApp.contacts.visibility')}</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((contact, index) => (
                <TableRow key={contact.id}>
                  <TableCell className="text-muted-foreground">{contact.role}</TableCell>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell className="font-mono">
                    <a className="text-link" href={`tel:${contact.phone}`}>
                      {localPhone(contact.phone)}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant={contact.shown ? 'success' : 'secondary'}>
                      {contact.shown
                        ? t('customerApp.contacts.shownBadge')
                        : t('customerApp.contacts.hiddenBadge')}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <RowActions>
                      <RowAction
                        label={`${t('customerApp.contacts.up')}: ${contact.name}`}
                        icon={ArrowUp}
                        disabled={index === 0 || save.isPending}
                        onClick={() => move(index, -1)}
                      />
                      <RowAction
                        label={`${t('customerApp.contacts.down')}: ${contact.name}`}
                        icon={ArrowDown}
                        disabled={index === rows.length - 1 || save.isPending}
                        onClick={() => move(index, 1)}
                      />
                      <RowAction
                        label={t('common.editRecord', { name: contact.name })}
                        icon={Pencil}
                        onClick={() => {
                          action.clear();
                          setEditing(contact);
                        }}
                      />
                      <RowAction
                        label={`${t('customerApp.contacts.remove')}: ${contact.name}`}
                        icon={Trash2}
                        destructive
                        onClick={() => deletion.ask(contact)}
                      />
                    </RowActions>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      {editing ? (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
          onSave={saveRow}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('customerApp.contacts.removeTitle', { name: deletion.target?.name ?? '' })}
        description={t('customerApp.contacts.removeDescription')}
        confirmLabel={t('customerApp.contacts.remove')}
        pending={deletion.pending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </Card>
  );
}

const contactSchema = z.object({
  role: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .max(CONTACT_LIMITS.maxRole, 'validation.tooLong'),
  name: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .max(CONTACT_LIMITS.maxName, 'validation.tooLong'),
  phone: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .refine((value) => normalizeMnPhone(value) !== null, 'validation.phone'),
  shown: z.boolean(),
});
type ContactValues = z.infer<typeof contactSchema>;

/** One contact person: role, name, phone (stored in E.164) and whether the app lists them. */
function ContactDialog(props: {
  contact: CompanyContact | null;
  onSave: (values: CompanyContactRequest) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useAction();
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      role: props.contact?.role ?? '',
      name: props.contact?.name ?? '',
      phone: phoneInput(props.contact?.phone ?? null),
      shown: props.contact?.shown ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const phone = normalizeMnPhone(values.phone);
    if (!phone) return;
    const ok = await action.run(() =>
      props.onSave({ role: values.role, name: values.name, phone, shown: values.shown }),
    );
    if (ok) props.onClose();
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {props.contact
                ? t('customerApp.contacts.editTitle')
                : t('customerApp.contacts.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('customerApp.contacts.role')}
            htmlFor="company-contact-role"
            hint={t('customerApp.contacts.roleHint')}
            error={errors.role?.message}
          >
            <Input id="company-contact-role" autoComplete="off" {...form.register('role')} />
          </FormField>
          <FormField
            label={t('customerApp.contacts.name')}
            htmlFor="company-contact-name"
            error={errors.name?.message}
          >
            <Input id="company-contact-name" autoComplete="off" {...form.register('name')} />
          </FormField>
          <FormField
            label={t('customerApp.contacts.phone')}
            htmlFor="company-contact-phone"
            error={errors.phone?.message}
          >
            <Input
              id="company-contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="font-mono sm:w-44"
              {...form.register('phone')}
            />
          </FormField>
          <Controller
            control={form.control}
            name="shown"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="company-contact-shown">{t('customerApp.contacts.shown')}</Label>
                <Switch
                  id="company-contact-shown"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Аппын захиалга»: whether a stage without an action takes the CUSTOMER_APP channel (ADR-0079 #5,
 * set in the boards' «Сувгийн тохиргоо») and how many stores have the app open. Read-only.
 */
function OrdersCard() {
  const { t } = useTranslation();
  const attention = useCustomerAppAttention(true);
  const data = attention.data;
  return (
    <Card role="region" aria-label={t('customerApp.orders.title')}>
      <CardHeader>
        <CardTitle>{t('customerApp.orders.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(attention.error)} onRetry={attention.refetch} />
        {attention.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {data ? (
          <>
            {data.ordersOpen ? (
              <div className="flex flex-col gap-1.5">
                <Badge variant="success" className="self-start">
                  {t('customerApp.orders.open')}
                </Badge>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t('customerApp.orders.openHint')}
                </p>
              </div>
            ) : (
              <Alert className="border-transparent bg-warning-soft shadow-none!">
                <TriangleAlert aria-hidden className="text-warning" />
                <AlertTitle className="text-warning">{t('customerApp.orders.closed')}</AlertTitle>
                <AlertDescription className="text-warning">
                  {t('customerApp.orders.closedHint')}
                </AlertDescription>
              </Alert>
            )}
            <p className="text-sm">
              {t('customerApp.orders.accounts', { n: formatCount(data.activeAccounts) })}
            </p>
            <Button asChild variant="link" size="sm" className="self-start px-0">
              <Link to="/sales/boards/settings">{t('customerApp.orders.settings')}</Link>
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
