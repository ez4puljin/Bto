import { House } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

/**
 * An address the app does not know: a page of its own (ADR-0066), so the browser tab says so
 * instead of keeping the last page's name; the menu stays beside it.
 */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t('errors.notFound')} description={t('errors.notFoundHint')} />
      <Button asChild variant="outline">
        <Link to="/">
          <House />
          {t('errors.goHome')}
        </Link>
      </Button>
    </div>
  );
}
