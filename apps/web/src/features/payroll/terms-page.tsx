import { PAYROLL_AMOUNT_PATTERN } from '@tugeel/shared/payroll';
import { businessDate } from '@tugeel/shared/time';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Wallet } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasAnyPermission, useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  ButtonRow,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDivisions } from '@/features/hr/workforce-api';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type PayrollTerms, usePayrollMutations, useAllTerms, useTemplates } from './payroll-api';
import { draftsOf, type ItemDraft, itemsProblem, money, requestOf } from './payroll-helpers';
import { KpiItemsEditor } from './payroll-kit';

// The name with the position, the salary, the insurance flag and the KPI sum always stay; the
// division, the template and the status leave a narrow table first.
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 15 },
  { key: 'division', kind: 'text', weight: 2, min: 8, drop: 2 },
  { key: 'salary', kind: 'money', width: 9.5 },
  { key: 'insurance', kind: 'status', width: 7.5 },
  { key: 'kpi', kind: 'money', width: 9.5 },
  { key: 'template', kind: 'text', weight: 2, min: 9, drop: 1 },
  { key: 'status', kind: 'status', width: 8.5, drop: 3 },
  { key: 'chevron', kind: 'chevron' },
];

/** One person's pay terms: the fixed salary, the insurance flag and their own KPI sheet. */
function TermsDialog(props: { terms: PayrollTerms; onClose: () => void }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.payroll.manage');
  const canReadPositions = useHasAnyPermission(['hr.attendance.view', 'hr.attendance.manage']);
  const templates = useTemplates();
  const mutations = usePayrollMutations();
  const action = useAction();
  const { terms } = props;
  const positionDerived = terms.positionId !== null;
  const [salary, setSalary] = useState(terms.hasTerms ? terms.baseSalary.replace(/\.00$/, '') : '');
  const [insured, setInsured] = useState(terms.paysSocialInsurance);
  const [active, setActive] = useState(terms.hasTerms ? terms.active : true);
  const [items, setItems] = useState<ItemDraft[]>(() => draftsOf(terms.items));
  const [templateId, setTemplateId] = useState<number | null>(terms.templateId);
  const [error, setError] = useState<string | undefined>();
  const [itemsError, setItemsError] = useState<string | undefined>();
  const close = () => {
    action.clear();
    props.onClose();
  };
  const copyTemplate = () => {
    const template = templates.data?.find((row) => row.id === templateId);
    if (!template) return;
    setItemsError(undefined);
    setItems(draftsOf(template.items).map((draft) => ({ ...draft, key: null })));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!positionDerived && !PAYROLL_AMOUNT_PATTERN.test(salary)) {
      setError('validation.money');
      return;
    }
    const problem = itemsProblem(items);
    if (problem) {
      setItemsError(problem);
      return;
    }
    const ok = await action.run(() =>
      mutations.saveTerms.mutateAsync({
        userId: terms.userId,
        ...(positionDerived ? {} : { baseSalary: salary }),
        paysSocialInsurance: insured,
        templateId,
        items: requestOf(items),
        active,
      }),
    );
    if (ok) {
      toast.success(t('payroll.web.terms.saved'));
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <DialogHeader>
          <DialogTitle>{terms.fullName}</DialogTitle>
          <p className="text-[0.8125rem] text-muted-foreground">
            {[terms.position, terms.divisionName].filter(Boolean).join(' · ') || t('common.none')}
          </p>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <div className="@container">
            <div className="grid gap-4 @lg:grid-cols-3">
              {positionDerived ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t('payroll.web.terms.salary')}</p>
                  <p className="font-mono text-lg">{money(terms.baseSalary)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('hr.positions.derivedSalary', { name: terms.position })}
                  </p>
                  {terms.positionSalaryEffectiveMonth &&
                  terms.positionSalaryEffectiveMonth > businessDate().slice(0, 7) ? (
                    <p className="text-xs text-muted-foreground">
                      {t('hr.positions.assignmentHint', {
                        month: terms.positionSalaryEffectiveMonth,
                      })}
                    </p>
                  ) : null}
                  {terms.nextBaseSalary && terms.nextEffectiveMonth ? (
                    <p className="text-xs text-muted-foreground">
                      {t('hr.positions.scheduledAmount', {
                        amount: money(terms.nextBaseSalary),
                        month: terms.nextEffectiveMonth,
                      })}
                    </p>
                  ) : null}
                  {canReadPositions ? (
                    <Link className="text-xs text-link" to="/hr/positions">
                      {t('hr.positions.title')}
                    </Link>
                  ) : null}
                </div>
              ) : (
                <FormField
                  label={t('payroll.web.terms.salary')}
                  htmlFor="terms-salary"
                  error={error}
                >
                  <MoneyInput
                    id="terms-salary"
                    autoFocus={canManage}
                    suffix="₮"
                    disabled={!canManage}
                    value={salary}
                    onValueChange={(raw) => {
                      setError(undefined);
                      setSalary(raw);
                    }}
                  />
                </FormField>
              )}
              <FormField
                label={t('payroll.web.terms.insured')}
                htmlFor="terms-insured"
                hint={t('payroll.web.terms.insuredHint')}
              >
                <Switch
                  id="terms-insured"
                  disabled={!canManage}
                  checked={insured}
                  onCheckedChange={setInsured}
                />
              </FormField>
              <FormField
                label={t('payroll.web.terms.active')}
                htmlFor="terms-active"
                hint={t('payroll.web.terms.activeHint')}
              >
                <Switch
                  id="terms-active"
                  disabled={!canManage}
                  checked={active}
                  onCheckedChange={setActive}
                />
              </FormField>
            </div>
          </div>
          <FormField label={t('payroll.web.terms.items')} error={itemsError}>
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="terms-template" className="sr-only">
                  {t('payroll.web.terms.template')}
                </Label>
                <NativeSelect
                  id="terms-template"
                  className="max-w-72"
                  value={templateId === null ? '' : String(templateId)}
                  onChange={(event) =>
                    setTemplateId(event.target.value === '' ? null : Number(event.target.value))
                  }
                >
                  <option value="">{t('payroll.web.terms.noTemplate')}</option>
                  {(templates.data ?? []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={templateId === null}
                  onClick={copyTemplate}
                >
                  {t('payroll.web.terms.copyTemplate')}
                </Button>
              </div>
            ) : null}
            <KpiItemsEditor
              idPrefix="terms-item"
              items={items}
              disabled={!canManage}
              onChange={(next) => {
                setItemsError(undefined);
                setItems(next);
              }}
            />
          </FormField>
          {canManage ? (
            <DialogFormFooter
              pending={mutations.saveTerms.isPending}
              onCancel={close}
              start={
                <span className="text-xs text-muted-foreground">
                  {t('payroll.web.terms.laterRuns')}
                </span>
              }
            />
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Цалингийн нөхцөл» (ADR-0235, hr.payroll.view) lists the
 * employed staff with the fixed salary, whether they pay social insurance and the KPI total; a row
 * opens the person's terms in a window (`?user=`), which hr.payroll.manage may change.
 */
export function PayrollTermsPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const terms = useAllTerms();
  const divisions = useDivisions();
  const query = search.get('q') ?? '';
  const divisionParam = search.get('division') ?? '';
  const showLeft = search.get('left') === '1';
  const open = Number(search.get('user') ?? '');
  const rows = useMemo(() => {
    const words = queryTerms(query);
    return (terms.data ?? [])
      .filter((row) => row.left === showLeft)
      .filter((row) => divisionParam === '' || String(row.divisionId) === divisionParam)
      .filter(
        (row) =>
          words.length === 0 ||
          matchesQuery(
            searchKeys(row.fullName, [row.position ?? '', row.divisionName ?? '']),
            words,
          ),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }, [terms.data, query, divisionParam, showLeft]);
  const opened =
    Number.isInteger(open) && open > 0 ? terms.data?.find((row) => row.userId === open) : undefined;
  const filtered = query !== '' || divisionParam !== '' || showLeft;

  return (
    <div>
      <PageHeader
        title={t('payroll.web.terms.title')}
        description={t('payroll.web.terms.description')}
      />
      <FilterBar
        end={
          terms.data ? (
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('payroll.web.terms.count', { count: rows.length })}
            </span>
          ) : null
        }
      >
        <SearchField
          className="sm:w-auto sm:max-w-72 sm:min-w-48 sm:flex-1"
          aria-label={t('payroll.web.search')}
          placeholder={t('payroll.web.search')}
          value={query}
          onChange={(event) => setParam('q', event.target.value || null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('payroll.web.division')}
          value={divisionParam}
          onChange={(event) => setParam('division', event.target.value || null)}
        >
          <option value="">{t('payroll.web.allDivisions')}</option>
          {(divisions.data ?? []).map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('payroll.web.terms.showLeft')}
          checked={showLeft}
          onCheckedChange={(checked) => setParam('left', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(terms.error)} onRetry={terms.refetch} />
      <ListCard scroll>
        {terms.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('payroll.web.noMatch') : t('payroll.web.terms.empty')}
            icon={Wallet}
            onClearFilters={
              filtered
                ? () => {
                    setParam('q', null);
                    setParam('division', null);
                    setParam('left', null);
                  }
                : undefined
            }
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.web.terms.columns.employee')}</TableHead>
                <TableHead>{t('payroll.web.terms.columns.division')}</TableHead>
                <TableHead className="text-right">
                  {t('payroll.web.terms.columns.salary')}
                </TableHead>
                <TableHead>{t('payroll.web.terms.columns.insurance')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.terms.columns.kpi')}</TableHead>
                <TableHead>{t('payroll.web.terms.columns.template')}</TableHead>
                <TableHead>{t('payroll.web.terms.columns.status')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.isPending ? <SkeletonRows columns={8} /> : null}
              {rows.map((row) => (
                <ButtonRow
                  key={row.userId}
                  onOpen={() => setParam('user', String(row.userId))}
                  selected={row.userId === open}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="block w-full min-w-0 truncate text-left font-medium"
                      onClick={() => setParam('user', String(row.userId))}
                    >
                      {row.fullName}
                    </button>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.position ?? t('common.none')}
                    </span>
                  </TableCell>
                  <TableCell className="truncate">
                    {row.divisionName ?? (
                      <span className="text-muted-foreground">{t('common.none')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.hasTerms ? money(row.baseSalary) : t('common.none')}
                  </TableCell>
                  <TableCell>
                    {row.hasTerms ? (
                      row.paysSocialInsurance ? (
                        <Badge variant="success">{t('common.yes')}</Badge>
                      ) : (
                        <Badge variant="outline">{t('common.no')}</Badge>
                      )
                    ) : (
                      t('common.none')
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.hasTerms ? money(row.kpiTotal) : t('common.none')}
                  </TableCell>
                  <TableCell className="truncate">{row.templateName ?? t('common.none')}</TableCell>
                  <TableCell>
                    {!row.hasTerms ? (
                      <Badge variant="warning">{t('payroll.web.terms.noTerms')}</Badge>
                    ) : row.active ? (
                      <Badge variant="success">{t('payroll.web.terms.statusActive')}</Badge>
                    ) : (
                      <Badge variant="outline">{t('payroll.web.terms.statusOff')}</Badge>
                    )}
                  </TableCell>
                </ButtonRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {opened ? (
        <TermsDialog key={opened.userId} terms={opened} onClose={() => setParam('user', null)} />
      ) : null}
    </div>
  );
}
