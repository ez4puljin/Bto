import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ContactsCard } from './contacts-card';

/** «Апп» → «Холбоо барих» (ADR-0127): the contact list the customer app shows (ADR-0079 #14). */
export function AppContactsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader
        title={t('appSettings.contacts.title')}
        description={t('appSettings.contacts.description')}
      />
      <ContactsCard />
    </div>
  );
}
