import { cleanTaxNumber, isTinFor, normalizeRegNo, regNoShape } from '@tugeel/shared/taxpayer';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type Company, useCompany, useUpdateCompany } from './api';

/**
 * «Компани» (ADR-0084): the Finance Core company this installation books into. Every staff member
 * reads it; its legal identity is edited with finance.settings.manage. The tax registrations and
 * the mapped branches are shown, never edited here (settings and «Салбар» feed them).
 */
export function CompanyPage() {
  const { t } = useTranslation();
  const company = useCompany();
  const canEdit = useHasPermission('finance.settings.manage');
  return (
    <div className="space-y-4">
      <PageHeader title={t('company.title')} description={t('company.hint')} />
      <ProblemAlert problem={problemFromError(company.error)} />
      {company.data ? (
        <>
          <DetailCard
            title={t('company.identity')}
            canEdit={canEdit}
            view={<IdentityView company={company.data} />}
            edit={(close) => <IdentityForm company={company.data} onClose={close} />}
          />
          <TaxRegistrationsCard company={company.data} />
          <BranchesCard company={company.data} />
        </>
      ) : null}
    </div>
  );
}

function IdentityView({ company }: { company: Company }) {
  const { t } = useTranslation();
  return (
    <FieldList
      items={[
        { label: t('company.fields.legalName'), value: company.legalName },
        {
          label: t('company.fields.registerNo'),
          value: company.registerNo ? (
            <span className="font-mono">{company.registerNo}</span>
          ) : null,
        },
        {
          label: t('company.fields.tin'),
          value: company.tin ? <span className="font-mono">{company.tin}</span> : null,
        },
        {
          label: t('company.fields.code'),
          value: <span className="font-mono">{company.code}</span>,
        },
        { label: t('company.fields.functionalCurrency'), value: company.functionalCurrency },
        { label: t('company.fields.timezone'), value: company.timezone },
        {
          label: t('company.fields.fiscalYearStart'),
          value: t('company.fiscalMonth', { month: company.fiscalYearStartMonth }),
        },
      ]}
    />
  );
}

interface IdentityErrors {
  legalName?: string;
  registerNo?: string;
  tin?: string;
}

/** The checks the api makes, in the same shared rules (`@tugeel/shared/taxpayer`). */
function identityErrors(values: { legalName: string; registerNo: string; tin: string }) {
  const errors: IdentityErrors = {};
  const legalName = values.legalName.trim();
  if (!legalName) errors.legalName = 'validation.required';
  else if (legalName.length > 200) errors.legalName = 'validation.tooLong';
  const registerNo = values.registerNo.trim();
  if (registerNo && regNoShape(normalizeRegNo(registerNo)) !== 'COMPANY') {
    errors.registerNo = 'validation.regNoCompany';
  }
  const tin = values.tin.trim();
  if (tin && !isTinFor('COMPANY', cleanTaxNumber(tin))) errors.tin = 'validation.tinCompany';
  return errors;
}

function IdentityForm({ company, onClose }: { company: Company; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateCompany();
  const action = useAction();
  const [values, setValues] = useState({
    legalName: company.legalName,
    registerNo: company.registerNo ?? '',
    tin: company.tin ?? '',
  });
  const [checked, setChecked] = useState(false);
  const errors = checked ? identityErrors(values) : {};
  const set = (field: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((previous) => ({ ...previous, [field]: event.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(identityErrors(values)).length) return;
    void action
      .run(async () => {
        await update.mutateAsync({
          legalName: values.legalName.trim(),
          registerNo: values.registerNo.trim() || null,
          tin: values.tin.trim() || null,
        });
        toast.success(t('company.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <FormSection>
        <FormRow
          label={t('company.fields.legalName')}
          htmlFor="company-legal-name"
          error={errors.legalName}
        >
          <Input
            id="company-legal-name"
            value={values.legalName}
            maxLength={200}
            aria-invalid={Boolean(errors.legalName)}
            onChange={set('legalName')}
          />
        </FormRow>
        <FormRow
          label={t('company.fields.registerNo')}
          htmlFor="company-register-no"
          hint={t('company.registerNoHint')}
          error={errors.registerNo}
        >
          <Input
            id="company-register-no"
            className="font-mono sm:w-48"
            inputMode="numeric"
            autoComplete="off"
            value={values.registerNo}
            maxLength={32}
            aria-invalid={Boolean(errors.registerNo)}
            onChange={set('registerNo')}
          />
        </FormRow>
        <FormRow
          label={t('company.fields.tin')}
          htmlFor="company-tin"
          hint={t('company.tinHint')}
          error={errors.tin}
        >
          <Input
            id="company-tin"
            className="font-mono sm:w-48"
            inputMode="numeric"
            autoComplete="off"
            value={values.tin}
            maxLength={32}
            aria-invalid={Boolean(errors.tin)}
            onChange={set('tin')}
          />
        </FormRow>
      </FormSection>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

function TaxRegistrationsCard({ company }: { company: Company }) {
  const { t } = useTranslation();
  return (
    <Card role="region" aria-label={t('company.taxRegistrations')}>
      <CardHeader>
        <CardTitle>{t('company.taxRegistrations')}</CardTitle>
      </CardHeader>
      <CardContent className={company.taxRegistrations.length ? 'px-0' : undefined}>
        {company.taxRegistrations.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('company.taxKind')}</TableHead>
                <TableHead>{t('company.effectiveFrom')}</TableHead>
                <TableHead>{t('company.taxStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {company.taxRegistrations.map((entry) => (
                <TableRow key={`${entry.taxKind}:${entry.effectiveFrom}`}>
                  <TableCell>
                    {t(`company.taxKinds.${entry.taxKind}`, { defaultValue: entry.taxKind })}
                  </TableCell>
                  <TableCell className="font-mono">{entry.effectiveFrom}</TableCell>
                  <TableCell>
                    <Badge variant={entry.registered ? 'success' : 'secondary'}>
                      {entry.registered ? t('company.registered') : t('company.notRegistered')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t('company.noTaxRegistrations')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function BranchesCard({ company }: { company: Company }) {
  const { t } = useTranslation();
  return (
    <Card role="region" aria-label={t('company.branches')}>
      <CardHeader>
        <CardTitle>{t('company.branches')}</CardTitle>
        <CardDescription>{t('company.branchesHint')}</CardDescription>
      </CardHeader>
      <CardContent className={company.branches.length ? 'px-0' : undefined}>
        {company.branches.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('company.branchCode')}</TableHead>
                <TableHead>{t('company.branchName')}</TableHead>
                <TableHead>{t('company.branchStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {company.branches.map((branch) => (
                <TableRow key={branch.code}>
                  <TableCell className="font-mono">{branch.code}</TableCell>
                  <TableCell>{branch.name}</TableCell>
                  <TableCell>
                    <Badge variant={branch.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {t(`company.statuses.${branch.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t('company.noBranches')}</p>
        )}
      </CardContent>
    </Card>
  );
}
