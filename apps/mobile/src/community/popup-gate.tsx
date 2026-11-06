import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { FEED_KEY, type MyMessage, useFeed, useReadMessages } from '../api/community';
import { useSignedIn } from '../state/session';
import { useShop } from '../state/shop';
import { colors, fonts, radii, shadows, spacing, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Text } from '../ui/text';
import { useAt } from './parts';

/** Screens a popup never covers: the camera, a send under way, a pick or a transfer being counted. */
const BUSY_PATHS = new Set(['/scan', '/customers', '/checkout', '/password']);
const BUSY_PREFIXES = ['/picking/', '/transfers/'];

/**
 * HR's unread notices that pop up (ADR-0146) when the app starts and each time it returns to the
 * foreground, after a fresh feed, never from the minute's refresh. A chance that comes while a busy
 * screen is open waits until it is gone. What was shown counts as read when the card closes; what
 * the person did not reach comes up again at the next open.
 */
export function CommunityPopupGate() {
  const { pending } = useShop();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const feed = useFeed();
  const read = useReadMessages();
  const wanted = useRef(true);
  const showing = useRef(false);
  const [queue, setQueue] = useState<MyMessage[]>([]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!showing.current) wanted.current = true;
      void queryClient.invalidateQueries({ queryKey: FEED_KEY });
    });
    return () => subscription.remove();
  }, [queryClient]);

  const popups = feed.data?.popups;
  const busy =
    pending !== null ||
    BUSY_PATHS.has(pathname) ||
    BUSY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  useEffect(() => {
    if (!wanted.current || !popups || feed.isFetching || busy) return;
    wanted.current = false;
    if (popups.length === 0) return;
    showing.current = true;
    setQueue(popups);
  }, [popups, feed.isFetching, busy]);

  if (queue.length === 0) return null;
  return (
    <PopupCards
      queue={queue}
      onClose={(seen) => {
        read.mutate(seen);
        showing.current = false;
        setQueue([]);
      }}
    />
  );
}

/** One message at a time in the middle of the screen: its picture, title, date and text. */
function PopupCards({
  queue,
  onClose,
}: {
  queue: readonly MyMessage[];
  onClose: (seen: number[]) => void;
}) {
  const { t } = useTranslation();
  const { server } = useSignedIn();
  const at = useAt();
  const [index, setIndex] = useState(0);
  const message = queue[index];
  if (!message) return null;
  const hasNext = index + 1 < queue.length;
  const close = () => onClose(queue.slice(0, index + 1).map((entry) => entry.id));
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal accessibilityLabel={message.title}>
          {message.imageUrl ? (
            <Image
              source={{ uri: `${server}${message.imageUrl}` }}
              style={styles.picture}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
            <View style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {message.category ?? t(`mobile.community.messages.kinds.${message.kind}`)}
              </Text>
            </View>
            <Text style={type.title3}>{message.title}</Text>
            <Text style={type.secondary}>{at(message.publishAt)}</Text>
            <Text style={styles.body}>{message.body}</Text>
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => [
                styles.button,
                styles.closeButton,
                pressed && styles.closePressed,
              ]}
            >
              <Text style={type.button} numberOfLines={1}>
                {t('mobile.community.popup.close')}
              </Text>
            </Pressable>
            {hasNext ? (
              <PillButton
                height={48}
                style={styles.button}
                title={t('mobile.community.popup.next')}
                onPress={() => setIndex(index + 1)}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.popupBackdrop,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: '88%',
    borderRadius: radii.hero,
    backgroundColor: colors.card,
    overflow: 'hidden',
    boxShadow: shadows.popup,
  },
  picture: { width: '100%', height: 176 },
  scroll: { flexGrow: 0 },
  text: { paddingTop: 18, paddingHorizontal: 20, paddingBottom: spacing.md, gap: spacing.sm },
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  chipText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.link },
  body: { ...type.row, color: colors.label2 },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 20 },
  button: { flex: 1, paddingHorizontal: spacing.md },
  closeButton: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.closeFill,
  },
  closePressed: { backgroundColor: colors.fill },
});
