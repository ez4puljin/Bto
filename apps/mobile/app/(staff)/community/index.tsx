import { useRouter } from 'expo-router';
import {
  Angry,
  Bell,
  CalendarDays,
  Frown,
  HeartHandshake,
  IdCard,
  Laugh,
  type LucideIcon,
  MapPin,
  Meh,
  MessageSquareText,
  Newspaper,
  Smile,
  Vote,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFeed, useSetMood } from '../../../src/api/community';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const FACES = [
  { score: 1, Icon: Angry, color: colors.tint.red },
  { score: 2, Icon: Frown, color: colors.tint.orange },
  { score: 3, Icon: Meh, color: colors.tint.amber },
  { score: 4, Icon: Smile, color: colors.tint.teal },
  { score: 5, Icon: Laugh, color: colors.tint.green },
] as const;

/**
 * «Хамт олон» (ADR-0146): today's mood as five faces (a tap saves it, it can change the same day),
 * then the company's notices, news, polls, calendar, thanks, feedback, a sent location and the
 * person's own details. Every employee reaches it from their profile.
 */
export default function CommunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const feed = useFeed();
  const setMood = useSetMood();
  const chosen = setMood.isPending ? setMood.variables : (feed.data?.moodToday ?? null);

  const row = (Icon: LucideIcon, color: string, title: string, href: string, count = 0) => (
    <Row
      key={href}
      minHeight={52}
      icon={
        <IconTile color={color}>
          <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
        </IconTile>
      }
      title={title}
      right={<CountBadge count={count} ring={colors.card} />}
      onPress={() => router.push(href)}
    />
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.title')} onBack={() => router.back()} right={null} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
        }
      >
        <View style={styles.mood}>
          <Text style={type.heading}>{t('mobile.community.mood.title')}</Text>
          <View style={styles.faces}>
            {FACES.map(({ score, Icon, color }) => {
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
                  style={[styles.face, on && { backgroundColor: color }]}
                >
                  <Icon size={34} strokeWidth={1.8} color={on ? colors.primaryForeground : color} />
                </Pressable>
              );
            })}
          </View>
          <Text style={type.secondary}>{t('mobile.community.mood.hint')}</Text>
        </View>

        <Group inset={ICON_INSET} style={styles.group}>
          {row(
            Bell,
            colors.tint.red,
            t('mobile.community.rows.notices'),
            '/community/messages?kind=NOTICE',
            feed.data?.unreadNotices,
          )}
          {row(
            Newspaper,
            colors.tint.blue,
            t('mobile.community.rows.news'),
            '/community/messages?kind=NEWS',
            feed.data?.unreadNews,
          )}
          {row(
            Vote,
            colors.tint.indigo,
            t('mobile.community.rows.polls'),
            '/community/polls',
            feed.data?.openPolls,
          )}
          {row(
            CalendarDays,
            colors.tint.orange,
            t('mobile.community.rows.calendar'),
            '/community/calendar',
          )}
        </Group>

        <Group inset={ICON_INSET} style={styles.group}>
          {row(
            HeartHandshake,
            colors.tint.pink,
            t('mobile.community.rows.thanks'),
            '/community/thanks',
          )}
          {row(
            MessageSquareText,
            colors.tint.teal,
            t('mobile.community.rows.feedback'),
            '/community/feedback',
          )}
          {row(
            MapPin,
            colors.tint.green,
            t('mobile.community.rows.location'),
            '/community/location',
          )}
          {row(IdCard, colors.tint.gray, t('mobile.community.rows.profile'), '/community/profile')}
        </Group>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 },
  mood: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
  },
  faces: { flexDirection: 'row', justifyContent: 'space-between' },
  face: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  group: { marginTop: 22 },
});
