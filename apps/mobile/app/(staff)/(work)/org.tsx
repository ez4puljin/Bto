import { Newspaper, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NewsList } from '../../../src/org/news-list';
import { OrgHeader, OrgTopTabs } from '../../../src/org/org-header';
import { PeopleView } from '../../../src/org/people-view';
import { Page } from '../../../src/ui/layout';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

type Part = 'people' | 'news';

/**
 * «Байгууллага», the third tab: the person greeted with the bell, then «Манайхан» (the company's
 * people, found and called from here) and «Мэдээ» (the notices and news of «Хамт олон»).
 */
export default function OrgScreen() {
  const { t } = useTranslation();
  const inset = useStoreTabBarInset();
  const [part, setPart] = useState<Part>('people');
  return (
    <Page edges={[]}>
      <OrgHeader />
      <OrgTopTabs
        options={[
          { value: 'people', label: t('mobile.org.tabs.people'), Icon: UsersRound },
          { value: 'news', label: t('mobile.org.tabs.news'), Icon: Newspaper },
        ]}
        value={part}
        onChange={setPart}
      />
      {part === 'people' ? <PeopleView /> : <NewsList bottomInset={inset} />}
    </Page>
  );
}
