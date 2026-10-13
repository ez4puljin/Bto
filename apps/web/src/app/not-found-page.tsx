import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-4 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-fill text-muted-foreground">
        <SearchX aria-hidden className="size-5" />
      </span>
      <p className="text-[15px] font-medium">{t('errors.notFound')}</p>
    </div>
  );
}
