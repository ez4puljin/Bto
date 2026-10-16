import type { TFunction } from 'i18next';
import type { ListContact } from './api';
import { localPhone } from './phone';

/** «—» for an empty cell. */
export const none = (t: TFunction) => (
  <span className="text-muted-foreground">{t('common.none')}</span>
);

export const text = (value: string | null, t: TFunction) => (value ? value : none(t));

/** The first contact on one line: the name, then the phone. */
export const contactCell = (contact: ListContact | null, t: TFunction) =>
  contact ? (
    <span className="flex items-center gap-2">
      <span>{contact.name ?? t('common.none')}</span>
      {contact.phone ? (
        <span className="font-mono text-muted-foreground">{localPhone(contact.phone)}</span>
      ) : null}
    </span>
  ) : (
    none(t)
  );
