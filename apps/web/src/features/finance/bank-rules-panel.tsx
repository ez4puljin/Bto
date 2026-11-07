import {
  BANK_EXPORT_TYPES,
  BANK_LINE_ACTIONS,
  type BankExportType,
  type BankLineAction,
} from '@tugeel/shared/finance';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { accountOption } from './account-option';
import { useGlAccounts, useMoneyAccounts } from './api';
import { type BankRules, useBankMutations, useBankRules } from './bank-api';

/**
 * «Банкны хуулга хаах»'s rules (ADR-0169 #5): what a card settlement and a bank fee are filled with, the
 * accounts offered first and Erkhet's general party. Saving fills the open locked lines again.
 */
export function BankRulesPanel() {
  const { t } = useTranslation();
  const rules = useBankRules();
  if (rules.error) {
    return (
      <ProblemAlert problem={problemFromError(rules.error)} onRetry={() => void rules.refetch()} />
    );
  }
  if (!rules.data) return null;
  return (
    <RulesForm
      key={JSON.stringify(rules.data)}
      initial={rules.data}
      title={t('finance.bankStatements.tabs.settings')}
    />
  );
}

function RulesForm(props: { initial: BankRules; title: string }) {
  const { t } = useTranslation();
  const canEdit = useHasPermission('finance.journal.manage');
  const accounts = useGlAccounts();
  const money = useMoneyAccounts();
  const mutations = useBankMutations();
  const [rules, setRules] = useState<BankRules>(props.initial);
  const [adding, setAdding] = useState('');
  const set = (patch: Partial<BankRules>) => setRules((current) => ({ ...current, ...patch }));

  const options = (accounts.data ?? [])
    .filter((account) => account.status === 'ACTIVE' && account.journal !== 'INVENTORY')
    .map(accountOption);
  const byId = new Map((accounts.data ?? []).map((account) => [account.id, account]));
  const banks = (money.data ?? []).filter((row) => row.kind === 'BANK' && row.status === 'ACTIVE');
  const example = [
    rules.settlementDescription.trim(),
    t('finance.bankStatements.settings.exampleBank'),
  ]
    .filter(Boolean)
    .join(' ');

  const actionOptions = BANK_LINE_ACTIONS.map((value) => (
    <option key={value} value={value}>
      {t(`finance.bankStatements.actions.${value}`)}
    </option>
  ));

  return (
    <div className="mx-auto max-w-[60rem] space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('finance.bankStatements.settings.settlementTitle')}</CardTitle>
          <CardDescription>{t('finance.bankStatements.settings.settlementHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField
            htmlFor="bank-settlement-account"
            label={t('finance.bankStatements.settings.account')}
          >
            <SearchSelect
              id="bank-settlement-account"
              value={rules.settlementAccountId === null ? '' : String(rules.settlementAccountId)}
              options={options}
              onChange={(value) => set({ settlementAccountId: Number.parseInt(value, 10) })}
              onClear={() => set({ settlementAccountId: null })}
            />
          </FormField>
          <FormField
            htmlFor="bank-settlement-action"
            label={t('finance.bankStatements.settings.action')}
          >
            <NativeSelect
              id="bank-settlement-action"
              value={rules.settlementAction}
              onChange={(event) => set({ settlementAction: event.target.value as BankLineAction })}
            >
              {actionOptions}
            </NativeSelect>
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              htmlFor="bank-settlement-description"
              label={t('finance.bankStatements.settings.description')}
              hint={t('finance.bankStatements.settings.settlementDescriptionHint')}
            >
              <Input
                id="bank-settlement-description"
                value={rules.settlementDescription}
                onChange={(event) => set({ settlementDescription: event.target.value })}
              />
            </FormField>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('finance.bankStatements.settings.example', { value: example })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.bankStatements.settings.feeTitle')}</CardTitle>
          <CardDescription>{t('finance.bankStatements.settings.feeHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField
            htmlFor="bank-fee-account"
            label={t('finance.bankStatements.settings.account')}
          >
            <SearchSelect
              id="bank-fee-account"
              value={rules.feeAccountId === null ? '' : String(rules.feeAccountId)}
              options={options}
              onChange={(value) => set({ feeAccountId: Number.parseInt(value, 10) })}
              onClear={() => set({ feeAccountId: null })}
            />
          </FormField>
          <FormField
            htmlFor="bank-fee-description"
            label={t('finance.bankStatements.settings.description')}
          >
            <Input
              id="bank-fee-description"
              value={rules.feeDescription}
              onChange={(event) => set({ feeDescription: event.target.value })}
            />
          </FormField>
          <FormField htmlFor="bank-fee-action" label={t('finance.bankStatements.settings.action')}>
            <NativeSelect
              id="bank-fee-action"
              value={rules.feeAction}
              onChange={(event) => set({ feeAction: event.target.value as BankLineAction })}
            >
              {actionOptions}
            </NativeSelect>
          </FormField>
          <FormField htmlFor="bank-fee-export" label={t('finance.bankStatements.settings.export')}>
            <NativeSelect
              id="bank-fee-export"
              value={rules.feeExportType}
              onChange={(event) => set({ feeExportType: event.target.value as BankExportType })}
            >
              {BANK_EXPORT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.bankStatements.exportTypes.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.bankStatements.settings.partyTitle')}</CardTitle>
          <CardDescription>{t('finance.bankStatements.settings.partyHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField
            htmlFor="bank-party-code"
            label={t('finance.bankStatements.settings.partyCode')}
          >
            <Input
              id="bank-party-code"
              className="sm:w-44"
              value={rules.partyCode}
              onChange={(event) => set({ partyCode: event.target.value })}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.bankStatements.settings.countersTitle')}</CardTitle>
          <CardDescription>{t('finance.bankStatements.settings.countersHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rules.counterAccountIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('finance.bankStatements.settings.countersEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rules.counterAccountIds.map((id) => {
                const account = byId.get(id);
                const name = account ? `${account.code} · ${account.name}` : String(id);
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('finance.bankStatements.settings.countersRemove', {
                        account: name,
                      })}
                      onClick={() =>
                        set({
                          counterAccountIds: rules.counterAccountIds.filter((own) => own !== id),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SearchSelect
              aria-label={t('finance.bankStatements.settings.countersAdd')}
              placeholder={t('finance.bankStatements.settings.countersAdd')}
              className="w-full sm:w-96"
              value={adding}
              options={options}
              onChange={setAdding}
            />
            <Button
              type="button"
              variant="outline"
              disabled={adding === ''}
              onClick={() => {
                const id = Number.parseInt(adding, 10);
                if (!rules.counterAccountIds.includes(id)) {
                  set({ counterAccountIds: [...rules.counterAccountIds, id] });
                }
                setAdding('');
              }}
            >
              <Plus />
              {t('finance.bankStatements.settings.countersAdd')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.bankStatements.settings.accountsTitle')}</CardTitle>
          <CardDescription>{t('finance.bankStatements.settings.accountsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {banks.map((bank) => (
              <li key={bank.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-sm">
                <span className="w-20 text-muted-foreground tabular-nums">
                  {bank.glAccountCode}
                </span>
                <span className="min-w-0 flex-1 truncate">{bank.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {bank.bankAccountNo ?? t('finance.bankStatements.settings.accountsNoNumber')}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/finance/settings" className="text-sm text-link hover:underline">
            {t('finance.bankStatements.settings.accountsToSettings')}
          </Link>
        </CardContent>
      </Card>

      <ProblemAlert problem={problemFromError(mutations.saveRules.error)} />
      {canEdit ? (
        <div className="flex justify-end">
          <Button
            pending={mutations.saveRules.isPending}
            disabled={!rules.feeDescription.trim() || !rules.partyCode.trim()}
            onClick={() =>
              mutations.saveRules.mutate(rules, {
                onSuccess: () => toast.success(t('finance.bankStatements.settings.saved')),
              })
            }
          >
            {t('finance.bankStatements.settings.save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
