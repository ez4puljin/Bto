import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMarkRead, useNotificationSummary } from '../../src/api/notifications';
import { popupQueue } from '../../src/notifications/feed';
import { KIND_STYLES, KindIcon, useNoticeEyebrow } from '../../src/notifications/kinds';
import { useSignedIn } from '../../src/state/session';
import { colors, radii, spacing, type } from '../../src/theme/tokens';
import { Button } from '../../src/ui/kit';

/**
 * The notices that pop up when the app opens (ADR-0062 #3), one at a time in the middle of the
 * screen. A notice counts as read once shown, so it never pops up again, even after the back
 * button; «Бараа харах» opens its products, «Хаах» the next one or the screen behind.
 */
export default function NoticePopup() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const summary = useNotificationSummary();
  const { mutate: markRead } = useMarkRead();
  const eyebrow = useNoticeEyebrow();
  // The queue as it was when the popup opened: reading one does not reorder the rest.
  const [queue] = useState(() => popupQueue(summary.data?.notices ?? []));
  const [index, setIndex] = useState(0);
  const notice = queue[index];
  const noticeId = notice?.id ?? null;

  useEffect(() => {
    if (noticeId === null) router.back();
    else markRead({ noticeIds: [noticeId] });
  }, [noticeId, markRead, router]);

  if (!notice) return null;
  const tint = KIND_STYLES[notice.kind];
  const next = () => (index + 1 < queue.length ? setIndex(index + 1) : router.back());

  return (
    <View style={styles.backdrop}>
      <View style={styles.card} accessibilityViewIsModal>
        {notice.imageUrl ? (
          <Image
            source={{ uri: `${server}${notice.imageUrl}` }}
            style={styles.image}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.hero, { backgroundColor: tint.soft }]}>
            <KindIcon kind={notice.kind} size={40} />
          </View>
        )}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
          <Text style={[type.caption, { color: tint.strong }]}>{eyebrow(notice)}</Text>
          <Text style={type.heading}>{notice.title}</Text>
          <Text style={type.body}>{notice.body}</Text>
        </ScrollView>
        {queue.length > 1 ? (
          <View
            style={styles.dots}
            accessibilityLabel={t('mobile.notifications.counter', {
              n: index + 1,
              total: queue.length,
            })}
          >
            {queue.map((entry, at) => (
              <View key={entry.id} style={[styles.dot, at === index && styles.dotOn]} />
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          {notice.productIds.length > 0 ? (
            <Button
              title={t('mobile.notifications.viewProducts', { n: notice.productIds.length })}
              onPress={() => router.replace(`/notice/${notice.id}`)}
            />
          ) : null}
          <Button variant="ghost" title={t('mobile.notifications.close')} onPress={next} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    backgroundColor: colors.card,
    borderRadius: radii.sheet,
    overflow: 'hidden',
  },
  image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.fill },
  hero: { width: '100%', height: 120, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  text: { padding: spacing.lg, gap: spacing.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.fill },
  dotOn: { backgroundColor: colors.primary },
  actions: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
});
