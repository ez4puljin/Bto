import { useIsFocused, useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useStoreMe } from '../../src/api/customer';
import {
  DaySeparator,
  MessageBubble,
  OutgoingBubble,
  QuickReplies,
  useChatDayTitle,
} from '../../src/chat/bubbles';
import { Composer } from '../../src/chat/composer';
import { useChatStreamDown } from '../../src/chat/connection';
import { useCustomerChat } from '../../src/chat/customer-chat';
import { type ChatRow, invertedRowsOf } from '../../src/chat/logic';
import { phoneShown } from '../../src/customer/home';
import { callNow } from '../../src/phone/call';
import { useCustomer } from '../../src/state/session';
import { colors, fonts, spacing, type } from '../../src/theme/tokens';
import { EmptyState } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { HeaderTextButton, StoreHeader } from '../../src/ui/store-header';
import { Text } from '../../src/ui/text';
import { useToast } from '../../src/ui/toast';

/**
 * «Чат» of «Bto300» (ADR-0224): the store's one conversation with the company. The bot's greeting
 * and answers and the staff's messages stand on the left (a staff member's name, «Бот»), the store's
 * on the right, the newest at the bottom; scrolling up loads older ones. The buttons the server
 * offers are chips above the input; a typed message shows at once and says so when it failed.
 * «Залгах» calls the store's sales rep, or opens «Профайл» where «Холбоо барих» is when there is none.
 * With the stream down the loaded history stays, under a quiet «Холболт тасарсан».
 */
export default function CustomerChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { me } = useCustomer();
  const today = useStoreMe().data?.today ?? me.store.today;
  const focused = useIsFocused();
  const chat = useCustomerChat(focused);
  const dayTitle = useChatDayTitle(today);
  const streamDown = useChatStreamDown();
  const { state } = chat;
  const unread = state?.conversation.unread ?? 0;
  const { markRead } = chat;

  // The screen is open and in front: what reaches the store now is read at once.
  useEffect(() => {
    if (focused && unread > 0) markRead();
  }, [focused, unread, markRead]);

  const call = async () => {
    const rep = state?.rep ?? null;
    if (rep?.phone) {
      const outcome = await callNow(rep.phone);
      if (outcome !== 'none') {
        toast.show({
          message: t('mobile.customer.chat.calling', {
            name: rep.name,
            phone: phoneShown(rep.phone),
          }),
        });
      }
    } else {
      router.push('/profile');
    }
  };

  const rows = state ? invertedRowsOf(state.messages, chat.outgoing) : [];
  const offline = streamDown || (chat.failed && state !== undefined);

  const renderRow = ({ item }: { item: ChatRow }) => {
    switch (item.kind) {
      case 'day':
        return <DaySeparator title={dayTitle(item.day)} />;
      case 'message':
        return <MessageBubble message={item.message} mine={item.message.sender === 'CUSTOMER'} />;
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
        title={t('mobile.customer.chat.title')}
        onBack={() => router.back()}
        right={
          <HeaderTextButton title={t('mobile.customer.chat.call')} onPress={() => void call()} />
        }
      />
      {state === undefined ? (
        chat.failed ? (
          <View style={styles.center}>
            <EmptyState
              icon={<MessageCircle size={40} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.customer.chat.openFailed')}
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
          {state.conversation.awaitingStaff ? (
            <Text style={[type.secondary, styles.note]}>{t('mobile.customer.chat.awaiting')}</Text>
          ) : null}
          <QuickReplies
            buttons={state.conversation.buttons}
            onPress={(button) => chat.send({ buttonId: button.id }, button.label)}
          />
          <Composer onSend={(text) => chat.send({ text }, text)} />
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
