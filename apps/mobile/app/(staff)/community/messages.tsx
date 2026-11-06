import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bell, Newspaper } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { type MessageKind, type MyMessage, useMyMessages } from '../../../src/api/community';
import { FirstLoad, useAt } from '../../../src/community/parts';
import { useSignedIn } from '../../../src/state/session';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { Segmented } from '../../../src/ui/controls';
import { EmptyState } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * Notices and news as two lists (ADR-0146): a picture, the title, the date and an unread dot.
 * Opening one marks it read.
 */
export default function MessagesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const at = useAt();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<MessageKind>(params.kind === 'NEWS' ? 'NEWS' : 'NOTICE');
  const messages = useMyMessages();
  const all = useMemo(() => messages.data ?? [], [messages.data]);
  const rows = useMemo(() => all.filter((message) => message.kind === kind), [all, kind]);
  const label = (of: MessageKind) => {
    const name = t(`mobile.community.messages.kinds.${of}`);
    const n = all.filter((message) => message.kind === of && !message.read).length;
    return n > 0 ? t('mobile.community.messages.withCount', { label: name, n }) : name;
  };

  const renderMessage = ({ item }: { item: MyMessage }) => {
    const Icon = item.kind === 'NOTICE' ? Bell : Newspaper;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          item.read ? item.title : `${item.title}, ${t('mobile.community.messages.unread')}`
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
          <View style={[styles.picture, styles.noPicture]}>
            <Icon size={24} strokeWidth={1.8} color={colors.input} />
          </View>
        )}
        <View style={styles.grow}>
          <Text style={item.read ? type.row : type.rowStrong} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={type.secondary} numberOfLines={1}>
            {at(item.publishAt)}
          </Text>
        </View>
        {item.read ? null : <View style={styles.dot} />}
      </Pressable>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.messages.title')}
        onBack={() => router.back()}
        right={null}
      />
      <View style={styles.tabs}>
        <Segmented
          label={t('mobile.community.messages.title')}
          options={[
            { value: 'NOTICE', label: label('NOTICE') },
            { value: 'NEWS', label: label('NEWS') },
          ]}
          value={kind}
          onChange={setKind}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(message) => String(message.id)}
        renderItem={renderMessage}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={messages.isRefetching}
            onRefresh={() => void messages.refetch()}
          />
        }
        ListEmptyComponent={
          <FirstLoad query={messages}>
            <EmptyState
              icon={
                kind === 'NOTICE' ? (
                  <Bell size={44} strokeWidth={1.5} color={colors.input} />
                ) : (
                  <Newspaper size={44} strokeWidth={1.5} color={colors.input} />
                )
              }
              title={t(
                kind === 'NOTICE'
                  ? 'mobile.community.messages.emptyNotices'
                  : 'mobile.community.messages.emptyNews',
              )}
            />
          </FirstLoad>
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 14, paddingTop: spacing.md },
  list: { paddingHorizontal: 14, paddingTop: spacing.md, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 76,
    padding: 10,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  pressed: { backgroundColor: colors.accent },
  picture: { width: 56, height: 56, borderRadius: 10 },
  noPicture: {
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  separator: { height: spacing.sm },
});
