import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {
  DaySeparator,
  MessageBubble,
  OutgoingBubble,
  useChatDayTitle,
} from '../../../src/chat/bubbles';
import { Composer } from '../../../src/chat/composer';
import { useChatStreamDown } from '../../../src/chat/connection';
import { type ChatRow, invertedRowsOf } from '../../../src/chat/logic';
import { useStaffChat } from '../../../src/chat/staff-chat';
import { ubDate } from '../../../src/dates/dates';
import { colors, fonts, spacing, type } from '../../../src/theme/tokens';
import { EmptyState } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { HeaderTextButton, StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/**
 * One conversation of «Харилцагчийн чат» (ADR-0224): the store in the header, the messages oldest
 * at the top (the staff's and the bot's on the right, the store's on the left), older ones on
 * scrolling up, the composer under them. «Хаах» asks first, then gives the conversation back to the
 * bot. It marks the store's messages read only while it is in front.
 */
export default function StaffChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const focused = useIsFocused();
  const chat = useStaffChat(id, focused);
  const dayTitle = useChatDayTitle(ubDate(new Date().toISOString()));
  const streamDown = useChatStreamDown();
  const { state, markRead } = chat;
  const unread = state?.conversation.unread ?? 0;

  // The screen is open and in front: what the store writes now is read at once.
  useEffect(() => {
    if (focused && unread > 0) markRead();
  }, [focused, unread, markRead]);

  const askClose = () =>
    Alert.alert(t('mobile.staffChat.closeTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mobile.staffChat.closeConfirm'),
        style: 'destructive',
        onPress: () => {
          void chat.close().then((done) => {
            if (done) {
              toast.show({ message: t('mobile.staffChat.closed') });
              router.back();
            } else {
              toast.show({ message: t('mobile.staffChat.closeFailed') });
            }
          });
        },
      },
    ]);

  const conversation = state?.conversation;
  const rows = state ? invertedRowsOf(state.messages, chat.outgoing) : [];
  const offline = streamDown || (chat.failed && state !== undefined);

  const renderRow = ({ item }: { item: ChatRow }) => {
    switch (item.kind) {
      case 'day':
        return <DaySeparator title={dayTitle(item.day)} />;
      case 'message':
        return (
          <MessageBubble
            message={item.message}
            mine={item.message.sender !== 'CUSTOMER'}
            staffView
          />
        );
      case 'outgoing':
        return (
          <OutgoingBubble
            outgoing={item.outgoing}
            onRetry={() => chat.retry(item.outgoing.key)}
            onDiscard={() => chat.discard(item.outgoing.key)}
          />
        );
    }
  };

  return (
    <Page edges={['bottom']}>
      <StoreHeader
        title={conversation?.customerName ?? t('mobile.staffChat.title')}
        subtitle={conversation?.customerCode ?? null}
        onBack={() => router.back()}
        right={
          conversation && conversation.mode === 'STAFF' ? (
            <HeaderTextButton title={t('mobile.staffChat.close')} onPress={askClose} />
          ) : null
        }
      />
      {state === undefined ? (
        chat.failed ? (
          <View style={styles.center}>
            <EmptyState
              icon={<MessageCircle size={40} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.staffChat.openFailed')}
              hint={t('mobile.customer.chat.openFailedHint')}
            />
            <Pressable accessibilityRole="button" onPress={chat.refetch} hitSlop={8}>
              <Text style={styles.reload}>{t('mobile.chat.reload')}</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        )
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.body}
        >
          <FlatList
            inverted
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            onEndReachedThreshold={0.4}
            onEndReached={chat.loadOlder}
            ListFooterComponent={
              chat.loadingOlder ? (
                <ActivityIndicator style={styles.older} color={colors.primary} />
              ) : null
            }
          />
          {offline ? (
            <Text accessibilityRole="alert" style={[type.secondary, styles.note]}>
              {t('mobile.chat.disconnected')}
            </Text>
          ) : null}
          {conversation?.mode === 'BOT' ? (
            <Text style={[type.secondary, styles.note]}>{t('mobile.staffChat.botHolds')}</Text>
          ) : null}
          <Composer onSend={(text) => chat.send(text)} />
        </KeyboardAvoidingView>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { paddingVertical: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loading: { marginTop: spacing.xxl },
  older: { marginVertical: spacing.md },
  reload: { ...type.button, color: colors.link, fontFamily: fonts.semibold },
  note: { textAlign: 'center', paddingTop: spacing.sm },
});
