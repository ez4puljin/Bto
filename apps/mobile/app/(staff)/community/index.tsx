import { useRouter } from 'expo-router';
import { Angry, Frown, Laugh, Meh, Smile } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFeed, useSetMood } from '../../../src/api/community';
import type { MenuKey } from '../../../src/staff/menu';
import { MENU_LOOK } from '../../../src/staff/menu-parts';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, PAGE } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** Each face: its colour when chosen and the soft disc behind it when not. */
const FACES = [
  { score: 1, Icon: Angry, color: colors.tint.red, soft: colors.destructiveSoft },
  { score: 2, Icon: Frown, color: colors.tint.orange, soft: colors.warningSoft },
  { score: 3, Icon: Meh, color: colors.tint.amber, soft: colors.warningSoft },
  { score: 4, Icon: Smile, color: colors.tint.teal, soft: colors.infoSoft },
  { score: 5, Icon: Laugh, color: colors.tint.green, soft: colors.successSoft },
] as const;

/**
 * «Хамт олон» (ADR-0146): today's mood as five faces (a tap saves it, it can change the same day),
 * then the company's notices, news, polls, calendar, thanks, feedback, a sent location and the
 * person's own details, each with the menu's own icon. Every employee reaches it from their profile.
 */
export default function CommunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const feed = useFeed();
  const setMood = useSetMood();
  const chosen = setMood.isPending ? setMood.variables : (feed.data?.moodToday ?? null);

  const row = (key: MenuKey, title: string, href: string, count = 0) => {
    const { Icon, color } = MENU_LOOK[key];
    return (
      <Row
        key={href}
        icon={
          <IconTile color={color}>
            <Icon size={18} strokeWidth={2.2} color={colors.primaryForeground} />
          </IconTile>
        }
        title={title}
        right={<CountBadge count={count} ring={colors.card} />}
        onPress={() => router.push(href)}
      />
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
        }
      >
        <Card style={styles.mood}>
          <Text style={type.heading}>{t('mobile.community.mood.title')}</Text>
          <View accessibilityRole="radiogroup" style={styles.faces}>
            {FACES.map(({ score, Icon, color, soft }) => {
              const on = chosen === score;
              return (
                <Pressable
                  key={score}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`mobile.community.mood.faces.${score}`)}
                  accessibilityState={{ checked: on }}
                  hitSlop={4}
                  onPress={() =>
                    setMood.mutate(score, {
                      onError: () => toast.show({ message: t('mobile.community.mood.failed') }),
                    })
                  }
                  style={[
                    styles.face,
                    { backgroundColor: on ? color : soft },
                    on && { boxShadow: `0 0 0 3px ${colors.card}, 0 0 0 5px ${color}` },
                  ]}
                >
                  <Icon size={30} strokeWidth={1.8} color={on ? colors.primaryForeground : color} />
                </Pressable>
              );
            })}
          </View>
          <Text style={type.secondary}>{t('mobile.community.mood.hint')}</Text>
        </Card>

        <SectionHeader style={styles.section}>{t('mobile.community.sections.info')}</SectionHeader>
        <Group inset={ICON_INSET}>
          {row(
            'notices',
            t('mobile.staffMenu.items.notices'),
            '/community/messages?kind=NOTICE',
            feed.data?.unreadNotices,
          )}
          {row(
            'news',
            t('mobile.staffMenu.items.news'),
            '/community/messages?kind=NEWS',
            feed.data?.unreadNews,
          )}
          {row(
            'polls',
            t('mobile.staffMenu.items.polls'),
            '/community/polls',
            feed.data?.openPolls,
          )}
          {row('calendar', t('mobile.staffMenu.items.calendar'), '/community/calendar')}
        </Group>

        <SectionHeader style={styles.section}>{t('mobile.community.sections.mine')}</SectionHeader>
        <Group inset={ICON_INSET}>
          {row('thanks', t('mobile.community.rows.thanks'), '/community/thanks')}
          {row('feedback', t('mobile.community.rows.feedback'), '/community/feedback')}
          {row('location', t('mobile.community.rows.location'), '/community/location')}
          {row('myDetails', t('mobile.community.rows.profile'), '/community/profile')}
        </Group>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: PAGE.padding, gap: PAGE.gap, paddingBottom: 40 },
  /** A label sits 16 px under the block above it and 8 px over its own list. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  mood: { gap: spacing.md },
  faces: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  face: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
