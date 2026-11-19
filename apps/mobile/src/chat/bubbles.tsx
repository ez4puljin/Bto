import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { feedDayOf } from '../customer/feed-lines';
import { ubTime } from '../dates/dates';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';
import type { ChatButton, ChatMessage, Outgoing } from './logic';

// The chat's building blocks, shared by the customer app and (later) the staff app: a message's
// bubble, one on its way, the day separator, the quick replies. Mine = the side the viewer writes
// from; the customer's app passes `mine` for CUSTOMER messages, the staff app will pass it for STAFF.

/** The day separator's words: «Өнөөдөр», «Өчигдөр · 10/17», «10/15 Пүрэв». */
export function useChatDayTitle(today: string | null): (day: string) => string {
  const { t } = useTranslation();
  return (day) => {
    const name = feedDayOf(day, today);
    switch (name.kind) {
      case 'today':
        return t('mobile.notifications.today');
      case 'yesterday':
        return t('mobile.customer.notifications.yesterdayDate', { date: name.date });
      case 'date':
        return t('mobile.orders.dayDate', {
          day: name.date,
          weekday: t(`mobile.weekdaysLong.${name.weekday}`),
        });
    }
  };
}

export function DaySeparator({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={[type.caption, styles.day]}>
      {title}
    </Text>
  );
}

/** A message of the server: the sender's name above (a staff member's name, «Бот»), the time under. */
export function MessageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t } = useTranslation();
  const who =
    message.sender === 'STAFF'
      ? message.staffName
      : message.sender === 'BOT'
        ? t('mobile.chat.bot')
        : null;
  return (
    <View style={[styles.line, mine ? styles.lineMine : styles.lineTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine && who ? (
          <Text style={[type.secondary, styles.who]} numberOfLines={1}>
            {who}
          </Text>
        ) : null}
        <Text selectable style={[type.body, mine && styles.textMine]}>
          {message.body}
        </Text>
        <Text style={[type.caption, styles.time, mine && styles.timeMine]}>
          {ubTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

/** A message on its way: dimmed while sending; failed, it says so and offers «Дахин илгээх». */
export function OutgoingBubble({
  outgoing,
  onRetry,
  onDiscard,
}: {
  outgoing: Outgoing;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const failed = outgoing.status !== 'sending';
  return (
    <View style={[styles.line, styles.lineMine]}>
      <View style={styles.outgoing}>
        <View style={[styles.bubble, styles.bubbleMine, !failed && styles.sending]}>
          <Text style={[type.body, styles.textMine]}>{outgoing.label}</Text>
        </View>
        {failed ? (
          <View accessibilityRole="alert" style={styles.failed}>
            <Text style={[type.secondary, styles.failedText]}>
              {outgoing.status === 'limited' ? t('mobile.chat.limited') : t('mobile.chat.failed')}
            </Text>
            <View style={styles.failedActions}>
              {outgoing.status === 'refused' ? null : (
                <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
                  <Text style={[type.secondary, styles.action]}>{t('mobile.chat.retry')}</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" onPress={onDiscard} hitSlop={8}>
                <Text style={[type.secondary, styles.action]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The buttons the server offers now: the labels as they come, a tap sends the button's id. */
export function QuickReplies({
  buttons,
  onPress,
}: {
  buttons: readonly ChatButton[];
  onPress: (button: ChatButton) => void;
}) {
  const { t } = useTranslation();
  if (buttons.length === 0) return null;
  return (
    <View accessibilityLabel={t('mobile.chat.quickReplies')} style={styles.chips}>
      {buttons.map((button) => (
        <Pressable
          key={button.id}
          accessibilityRole="button"
          onPress={() => onPress(button)}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
        >
          <Text style={styles.chipText} numberOfLines={2}>
            {button.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { alignSelf: 'center', marginVertical: spacing.md },
  line: { flexDirection: 'row', marginVertical: 3, paddingHorizontal: spacing.md },
  lineMine: { justifyContent: 'flex-end' },
  lineTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  who: { fontFamily: fonts.semibold, marginBottom: 2 },
  textMine: { color: colors.primaryForeground },
  time: { alignSelf: 'flex-end', marginTop: 2 },
  timeMine: { color: 'rgba(255,255,255,0.8)' },
  sending: { opacity: 0.6 },
  outgoing: { maxWidth: '82%', alignItems: 'flex-end' },
  failed: { marginTop: 2, alignItems: 'flex-end', gap: 2 },
  failedText: { color: colors.destructive },
  failedActions: { flexDirection: 'row', gap: spacing.lg },
  action: { color: colors.link, fontFamily: fonts.semibold },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  chipPressed: { backgroundColor: colors.secondary },
  chipText: { ...type.chip, color: colors.link },
});
