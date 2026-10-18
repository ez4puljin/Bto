import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { problemFromError } from '@/lib/problem';
import { useCategories, useUoms } from './api';
import { RegistrationForm } from './registration-form';

/**
 * Registering a new product (ADR-0044 #5): category and code, units, barcodes, supplier, home
 * warehouse and photos in one form. The product then waits for the price clerk. From `xl` on the
 * form takes two columns and the reading width; its buttons stick to the window's foot.
 */
export function ProductCreatePage() {
  const { t } = useTranslation();
  const uoms = useUoms();
  const categories = useCategories();
  const loadProblem = problemFromError(uoms.error ?? categories.error);

  return (
    <div className="max-w-3xl xl:max-w-none">
      <PageHeader title={t('catalog.product.newTitle')} />
      <ProblemAlert problem={loadProblem} />
      {uoms.data && categories.data ? (
        <RegistrationForm uoms={uoms.data} categories={categories.data} />
      ) : loadProblem ? null : (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
    </div>
  );
}
