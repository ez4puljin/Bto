import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';

export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <p role="alert" className="p-4 text-destructive">
      {notFound ? t('errors.notFound') : t('errors.unexpected')}
    </p>
  );
}
