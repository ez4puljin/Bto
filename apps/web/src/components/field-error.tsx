import { useTranslation } from 'react-i18next';
import { isValidationMessage } from '@/lib/forms';

/** A form field's validation message (an i18n key from the zod schema). */
export function FieldError({ message, id }: { message?: string | undefined; id?: string }) {
  const { t } = useTranslation();
  if (!isValidationMessage(message)) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {t(message)}
    </p>
  );
}
