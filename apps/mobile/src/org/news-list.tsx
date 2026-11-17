import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Megaphone, Newspaper } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type MyMessage, useMyMessages } from '../api/community';
import { FirstLoad, useAt } from '../community/parts';
import { useSignedIn } from '../state/session';
import { colors, radii, spacing, tabular, type } from '../theme/tokens';
import { Group } from '../ui/grouped';
import { EmptyState } from '../ui/kit';
import { PAGE } from '../ui/staff-kit';
import { Text } from '../ui/text';

const PICTURE = 56;

/**
 * «Байгууллага» → «Мэдээ»: the notices and news «Хамт олон» already holds (ADR-0146), newest first,
 * as «Мэдэгдэл ба мэдээ» draws them: a picture or the kind's icon, the title, the date and an unread
 * dot. A row opens the message, which marks it read.
 */
export function NewsList({ bottomInset }: { bottomInset: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const at = useAt();
  const messages = useMyMessages();
  const rows = messages.data ?? [];

  const renderMessage = (item: MyMessage) => {
    const notice = item.kind === 'NOTICE';
    const Icon = notice ? Megaphone : Newspaper;
    const kind = t(`mobile.community.messages.kinds.${item.kind}`);
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={
          item.read
            ? `${kind}: ${item.title}`
            : `${kind}: ${item.title}, ${t('mobile.community.messages.unread')}`
        }
        onPress={() => router.push(`/community/message/${item.id}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {item.imageUrl ? (
          <Image
            source={{ uri: `${server}${item.imageUrl}` }}
            style={styles.picture}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View
            style={[
              styles.picture,
              styles.noPicture,
              !item.read && (notice ? styles.unreadNotice : styles.unreadNews),
            ]}
          >
            <Icon
              size={24}
              strokeWidth={1.8}
              color={item.read ? colors.input : notice ? colors.tint.red : colors.link}
            />
          </View>
        )}
        <View style={styles.grow}>
          <Text style={item.read ? type.row : type.rowStrong} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {`${kind} · ${at(item.publishAt)}`}
          </Text>
        </View>
        {item.read ? null : <View style={styles.dot} />}
      </Pressable>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.body, { paddingBottom: bottomInset }]}
      refreshControl={
        <RefreshControl
          refreshing={messages.isRefetching}
          onRefresh={() => void messages.refetch()}
        />
      }
    >
      {rows.length > 0 ? (
        <Group inset={spacing.lg + PICTURE + spacing.md}>{rows.map(renderMessage)}</Group>
      ) : (
        <FirstLoad query={messages}>
          <EmptyState
            icon={<Newspaper size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('mobile.org.news.empty')}
          />
        </FirstLoad>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: PAGE.padding },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.accent },
  picture: { width: PICTURE, height: PICTURE, borderRadius: radii.field },
  noPicture: {
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadNotice: { backgroundColor: colors.destructiveSoft },
  unreadNews: { backgroundColor: colors.secondary },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: colors.primary,
  },
});
