import {
  isPeriodPreset,
  openViewQuery,
  PERIOD_PRESETS,
  type PeriodPreset,
  presetOf,
  REPORT_VIEW_NAME_MAX_LENGTH,
  type ReportViewPage,
  storedViewQuery,
} from '@tugeel/shared/reports';
import { businessDate } from '@tugeel/shared/time';
import { Bookmark, BookmarkPlus, Trash2, Users } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { DATE } from './report-helpers';
import { type ReportView, useReportViewMutations, useReportViews } from './report-views-api';

const FIXED = 'fixed';
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * «Загвар» on a report page (ADR-0194): the page's conditions, as its address holds them, kept
 * under a name and opened again with one press; the caller's own views and the ones others share.
 * A view with a moving period («Энэ сар») gets its dates on the day it is opened.
 */
export function ReportViews({ page }: { page: ReportViewPage }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const views = useReportViews(page);
  const mutations = useReportViewMutations(page);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ReportView | null>(null);
  const rows = views.data ?? [];
  const mine = rows.filter((view) => view.mine);
  const shared = rows.filter((view) => !view.mine);

  const show = (view: ReportView) => {
    setOpen(false);
    void navigate({ search: `?${openViewQuery(view, businessDate())}` });
  };
  // The confirmation takes the menu's place: two layers at once would fight over the focus.
  const askDelete = (view: ReportView) => {
    setOpen(false);
    setDeleting(view);
  };
  const closeDelete = () => {
    setDeleting(null);
    mutations.remove.reset();
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark />
            {t('reports.views.button')}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            aria-label={t('reports.views.title')}
            className="z-50 flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 flex-col rounded-xl border border-border bg-popover text-[0.8125rem] text-popover-foreground shadow-popover"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <ProblemAlert problem={problemFromError(views.error)} />
              {rows.length === 0 && !views.isPending && !views.error ? (
                <p className="px-2 py-3 leading-relaxed text-muted-foreground">
                  {t('reports.views.empty')}
                </p>
              ) : null}
              <ViewGroup
                label={t('reports.views.mine')}
                views={mine}
                onShow={show}
                onDelete={askDelete}
              />
              <ViewGroup
                label={t('reports.views.shared')}
                views={shared}
                onShow={show}
                onDelete={askDelete}
              />
            </div>
            <div className="border-t border-border p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  setSaving(true);
                }}
              >
                <BookmarkPlus />
                {t('reports.views.save')}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {saving ? (
        <SaveViewDialog
          page={page}
          search={search.toString()}
          own={mine}
          onClose={() => setSaving(false)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t('reports.views.deleteConfirm', { name: deleting?.name ?? '' })}
        description={deleting?.shared ? t('reports.views.deleteShared') : undefined}
        confirmLabel={t('common.delete')}
        pending={mutations.remove.isPending}
        problem={problemFromError(mutations.remove.error)}
        onConfirm={() => {
          if (!deleting) return;
          mutations.remove.mutate(deleting.id, {
            onSuccess: () => {
              closeDelete();
              toast.success(t('reports.views.deleted'));
            },
          });
        }}
        onClose={closeDelete}
      />
    </>
  );
}

function ViewGroup(props: {
  label: string;
  views: readonly ReportView[];
  onShow: (view: ReportView) => void;
  onDelete: (view: ReportView) => void;
}) {
  const { t } = useTranslation();
  if (props.views.length === 0) return null;
  return (
    <div className="pb-1">
      <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{props.label}</p>
      <ul>
        {props.views.map((view) => (
          <li key={view.id} className="flex items-center gap-0.5">
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              aria-label={t('reports.views.open', { name: view.name })}
              onClick={() => props.onShow(view)}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="truncate font-medium">{view.name}</span>
                {view.mine && view.shared ? (
                  <Users
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label={t('reports.views.sharedMark')}
                  />
                ) : null}
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">
                {[
                  view.period ? t(`reports.prompt.presets.${view.period}`) : null,
                  view.mine ? null : t('reports.views.sharedBy', { name: view.createdBy.fullName }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {view.removable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label={t('reports.views.delete', { name: view.name })}
                title={t('reports.views.delete', { name: view.name })}
                onClick={() => props.onDelete(view)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Names the view on screen. With both dates in the address the period is asked for: a moving one
 * (suggested when the dates are exactly a preset's today) or the dates as they are. A name the
 * caller already uses replaces that view.
 */
function SaveViewDialog(props: {
  page: ReportViewPage;
  search: string;
  own: readonly ReportView[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const mutations = useReportViewMutations(props.page);
  const action = useAction();
  const key = useRef(randomUuid());
  const params = new URLSearchParams(props.search);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const dated = DATE.test(from) && DATE.test(to);
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<PeriodPreset | typeof FIXED>(
    () => (dated ? presetOf(from, to, businessDate()) : null) ?? FIXED,
  );
  const [shared, setShared] = useState(false);
  const trimmed = name.trim();
  const existing = props.own.find((view) => sameName(view.name, trimmed));
  const pending = mutations.create.isPending || mutations.update.isPending;

  const submit = async () => {
    if (!trimmed || pending) return;
    const chosen = dated && period !== FIXED ? period : null;
    const body = { query: storedViewQuery(props.search, chosen), period: chosen, shared };
    const ok = await action.run(() =>
      existing
        ? mutations.update.mutateAsync({ id: existing.id, ...body })
        : mutations.create.mutateAsync({ key: key.current, name: trimmed, ...body }),
    );
    if (!ok) return;
    toast.success(t(existing ? 'reports.views.replaced' : 'reports.views.saved'));
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('reports.views.saveTitle')}</DialogTitle>
            <DialogDescription>{t('reports.views.saveDescription')}</DialogDescription>
          </DialogHeader>
          <FormField
            label={t('reports.views.nameLabel')}
            htmlFor={`${ids}-name`}
            hint={existing ? t('reports.views.replaces') : undefined}
          >
            <Input
              id={`${ids}-name`}
              value={name}
              maxLength={REPORT_VIEW_NAME_MAX_LENGTH}
              placeholder={t('reports.views.namePlaceholder')}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          {dated ? (
            <FormField
              label={t('reports.views.periodLabel')}
              htmlFor={`${ids}-period`}
              hint={t('reports.views.periodHint')}
            >
              <NativeSelect
                id={`${ids}-period`}
                value={period}
                onChange={(event) =>
                  setPeriod(isPeriodPreset(event.target.value) ? event.target.value : FIXED)
                }
              >
                <option value={FIXED}>
                  {t('reports.views.periodFixed', { period: `${from} – ${to}` })}
                </option>
                {PERIOD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {t(`reports.prompt.presets.${preset}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${ids}-shared`}
                checked={shared}
                onCheckedChange={(value) => setShared(value === true)}
              />
              <Label htmlFor={`${ids}-shared`}>{t('reports.views.shareLabel')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('reports.views.shareHint')}</p>
          </div>
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={pending}
            disabled={!trimmed}
            onCancel={props.onClose}
            submitLabel={t('common.save')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
