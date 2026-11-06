import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMyMessages, useReadMessages } from '../../../../src/api/community';
import { FirstLoad, useAt } from '../../../../src/community/parts';
import { useSignedIn } from '../../../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../../../src/theme/tokens';
import { EmptyState } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
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
        right={null}
      />
      {message ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            {message.imageUrl ? (
              <Image
                source={{ uri: `${server}${message.imageUrl}` }}
                style={styles.picture}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : null}
            <View style={styles.text}>
              {message.category ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {message.category}
                  </Text>
                </View>
              ) : null}
              <Text style={type.title3}>{message.title}</Text>
              <Text style={type.secondary}>{at(message.publishAt)}</Text>
              <Text style={styles.message}>{message.body}</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <FirstLoad query={messages}>
          <EmptyState
            icon={<Bell size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.community.messages.gone')}
          />
        </FirstLoad>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 14, paddingBottom: 40 },
  card: { borderRadius: radii.card, backgroundColor: colors.card, overflow: 'hidden' },
  picture: { width: '100%', height: 200 },
  text: { padding: spacing.lg, gap: spacing.sm },
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
  message: { ...type.row, color: colors.label2 },
});
