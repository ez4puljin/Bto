import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Megaphone, Newspaper } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMyMessages, useReadMessages } from '../../../../src/api/community';
import { FirstLoad, useAt } from '../../../../src/community/parts';
import { useSignedIn } from '../../../../src/state/session';
import { colors, spacing, tabular, type } from '../../../../src/theme/tokens';
import { EmptyState } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
import { Card, PAGE, Pill } from '../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';

/** One notice or news item in full (ADR-0146); opening it marks it read. */
export default function MessageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const at = useAt();
  const params = useLocalSearchParams<{ id: string }>();
  const messages = useMyMessages();
  const { mutate: markRead } = useReadMessages();
  const id = Number.parseInt(params.id, 10);
  const message = messages.data?.find((entry) => entry.id === id);
  const unread = message !== undefined && !message.read;

  useEffect(() => {
    if (unread) markRead([id]);
  }, [unread, id, markRead]);

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t(`mobile.community.messages.kinds.${message?.kind ?? 'NOTICE'}`)}
        onBack={() => router.back()}
      />
      {message ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Card flush>
            {message.imageUrl ? (
              <Image
                source={{ uri: `${server}${message.imageUrl}` }}
                style={styles.picture}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : null}
            <View style={styles.text}>
              <View style={styles.meta}>
                {message.category ? (
                  <Pill
                    label={message.category}
                    tone="info"
                    icon={message.kind === 'NOTICE' ? Megaphone : Newspaper}
                    style={styles.category}
                  />
                ) : null}
                <Text style={[type.secondary, tabular]}>{at(message.publishAt)}</Text>
              </View>
              <Text accessibilityRole="header" style={type.title2}>
                {message.title}
              </Text>
              <Text style={styles.message}>{message.body}</Text>
            </View>
          </Card>
        </ScrollView>
      ) : (
        <FirstLoad query={messages}>
          <EmptyState
            icon={<Megaphone size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('mobile.community.messages.gone')}
          />
        </FirstLoad>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: PAGE.padding, paddingBottom: 40 },
  picture: { width: '100%', height: 180 },
  text: { padding: spacing.lg, gap: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  category: { alignSelf: 'center', flexShrink: 1 },
  message: { ...type.row, color: colors.label2 },
});
