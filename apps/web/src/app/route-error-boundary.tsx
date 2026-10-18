import { RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

/**
 * A page that failed: inside the shell the menu stays, so the user can go elsewhere (ADR-0042).
 * The browser tab says what happened (ADR-0066), and «Дахин ачаалах» tries the page again. It
 * also stands in for the whole shell, so it keeps its own centred frame instead of a PageHeader.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? t('errors.notFound') : t('errors.unexpected');
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-4 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-destructive">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <p role="alert" className="text-[15px] font-medium text-foreground">
        {title}
      </p>
      <p className="text-[13px] text-muted-foreground">
        {notFound ? t('errors.notFoundHint') : t('errors.unexpectedHint')}
      </p>
      {notFound ? null : (
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RotateCw />
          {t('errors.reload')}
        </Button>
      )}
    </div>
  );
}
