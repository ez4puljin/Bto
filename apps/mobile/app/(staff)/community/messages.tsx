import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Megaphone, Newspaper } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type MessageKind, type MyMessage, useMyMessages } from '../../../src/api/community';
import { FirstLoad, useAt } from '../../../src/community/parts';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { PAGE } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

const PICTURE = 56;

/** The two lists' switch in the blue header: a translucent track, the chosen part white. */
function KindSwitch({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: MessageKind; label: string }[];
  value: MessageKind;
  onChange: (value: MessageKind) => void;
  label: string;
}) {
  return (
    <View style={styles.switchPad}>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.track}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(option.value)}
              hitSlop={{ top: 5, bottom: 5 }}
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text numberOfLines={1} style={on ? styles.segmentTextOn : styles.segmentText}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

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

  const renderMessage = (item: MyMessage) => {
    const notice = item.kind === 'NOTICE';
    const Icon = notice ? Megaphone : Newspaper;
    return (
      <Pressable
        key={item.id}
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
            {at(item.publishAt)}
          </Text>
        </View>
        {item.read ? null : <View style={styles.dot} />}
      </Pressable>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.messages.title')} onBack={() => router.back()}>
        <KindSwitch
          label={t('mobile.community.messages.title')}
          options={[
            { value: 'NOTICE', label: label('NOTICE') },
            { value: 'NEWS', label: label('NEWS') },
          ]}
          value={kind}
          onChange={setKind}
        />
      </StoreHeader>
      <ScrollView
        contentContainerStyle={styles.body}
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
              icon={
                kind === 'NOTICE' ? (
                  <Megaphone size={40} strokeWidth={1.5} color={colors.muted} />
                ) : (
                  <Newspaper size={40} strokeWidth={1.5} color={colors.muted} />
                )
              }
              title={t(
                kind === 'NOTICE'
                  ? 'mobile.community.messages.emptyNotices'
                  : 'mobile.community.messages.emptyNews',
              )}
            />
          </FirstLoad>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  switchPad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
  },
  segment: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentOn: { backgroundColor: colors.card },
  segmentText: { ...type.chip, color: colors.primaryForeground },
  segmentTextOn: { ...type.chip, fontFamily: fonts.semibold, color: colors.link },
  body: { padding: PAGE.padding, paddingBottom: 40 },
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
