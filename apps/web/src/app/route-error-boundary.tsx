import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';

/** A page that failed: inside the shell the menu stays, so the user can go elsewhere (ADR-0042). */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-4 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-destructive">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <p role="alert" className="text-[15px] font-medium text-foreground">
        {notFound ? t('errors.notFound') : t('errors.unexpected')}
      </p>
    </div>
  );
}
