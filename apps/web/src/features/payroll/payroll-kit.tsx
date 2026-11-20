import { PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PayrollRun } from './payroll-api';
import { draftsTotal, type ItemDraft, money, newDraft } from './payroll-helpers';

/*
 * Pieces the payroll pages share: money and percent for reading, the run's status pill and the
 * list of KPI items a template and a person's terms are both edited with.
 */

export function RunStatusBadge({ status }: { status: PayrollRun['status'] }) {
  const { t } = useTranslation();
  return status === 'APPROVED' ? (
    <Badge variant="success">{t('payroll.web.runs.statusApproved')}</Badge>
  ) : (
    <Badge variant="warning">{t('payroll.web.runs.statusDraft')}</Badge>
  );
}

/**
 * The KPI items of a template or a person: name, kind, amount and order, any number of rows.
 * A sheet holds at most one attendance item, so the kind of the others is fixed while one exists.
 */
export function KpiItemsEditor(props: {
  idPrefix: string;
  items: readonly ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const hasAttendance = props.items.some((item) => item.source === 'ATTENDANCE');
  const update = (rid: string, patch: Partial<ItemDraft>) =>
    props.onChange(props.items.map((item) => (item.rid === rid ? { ...item, ...patch } : item)));
  return (
    <div className="@container flex flex-col gap-2">
      {props.items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          {t('payroll.web.items.empty')}
        </p>
      ) : (
        <>
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(0,1fr)_14rem_9.5rem_4.5rem_2.25rem] gap-2 px-1 text-xs text-muted-foreground @2xl:grid"
          >
            <span>{t('payroll.web.items.name')}</span>
            <span>{t('payroll.web.items.source')}</span>
            <span>{t('payroll.web.items.amount')}</span>
            <span>{t('payroll.web.items.sort')}</span>
            <span />
          </div>
          <ul className="flex flex-col gap-2">
            {props.items.map((item, index) => {
              const id = `${props.idPrefix}-${index}`;
              return (
                <li
                  key={item.rid}
                  className="grid gap-2 rounded-lg border bg-card p-2 @2xl:grid-cols-[minmax(0,1fr)_14rem_9.5rem_4.5rem_2.25rem] @2xl:items-center @2xl:border-0 @2xl:bg-transparent @2xl:p-0"
                >
                  <Input
                    id={`${id}-name`}
                    aria-label={t('payroll.web.items.nameFor', { index: index + 1 })}
                    placeholder={t('payroll.web.items.name')}
                    maxLength={PAYROLL_LIMITS.maxName}
                    disabled={props.disabled}
                    value={item.name}
                    onChange={(event) => update(item.rid, { name: event.target.value })}
                  />
                  <NativeSelect
                    id={`${id}-source`}
                    aria-label={t('payroll.web.items.sourceFor', { index: index + 1 })}
                    disabled={props.disabled}
                    value={item.source}
                    onChange={(event) =>
                      update(item.rid, {
                        source: event.target.value === 'ATTENDANCE' ? 'ATTENDANCE' : 'MANUAL',
                      })
                    }
                  >
                    <option
                      value="ATTENDANCE"
                      disabled={hasAttendance && item.source !== 'ATTENDANCE'}
                    >
                      {t('payroll.web.items.sources.ATTENDANCE')}
                    </option>
                    <option value="MANUAL">{t('payroll.web.items.sources.MANUAL')}</option>
                  </NativeSelect>
                  <MoneyInput
                    id={`${id}-amount`}
                    aria-label={t('payroll.web.items.amountFor', { index: index + 1 })}
                    placeholder={t('payroll.web.items.amount')}
                    suffix="₮"
                    disabled={props.disabled}
                    value={item.amount}
                    onValueChange={(raw) => update(item.rid, { amount: raw })}
                  />
                  <Input
                    id={`${id}-sort`}
                    inputMode="numeric"
                    aria-label={t('payroll.web.items.sortFor', { index: index + 1 })}
                    placeholder={t('payroll.web.items.sort')}
                    disabled={props.disabled}
                    value={item.sort}
                    onChange={(event) =>
                      update(item.rid, { sort: event.target.value.replace(/\D/g, '') })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('payroll.web.items.removeFor', { index: index + 1 })}
                    disabled={props.disabled}
                    onClick={() =>
                      props.onChange(props.items.filter((other) => other.rid !== item.rid))
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled || props.items.length >= PAYROLL_LIMITS.maxItems}
          onClick={() => props.onChange([...props.items, newDraft(props.items)])}
        >
          <Plus />
          {t('payroll.web.items.add')}
        </Button>
        <span className="text-[0.8125rem] text-muted-foreground">
          {t('payroll.web.items.total', { amount: money(draftsTotal(props.items)) })}
        </span>
      </div>
    </div>
  );
}
