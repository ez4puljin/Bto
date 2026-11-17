import { useRouter } from 'expo-router';
import { Bell, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { feedCount, useFeed } from '../api/community';
import { useNotificationSummary } from '../api/notifications';
import { initialsOf } from '../format/format';
import { firstNameOf, greetingOf } from '../staff/home';
import { MyPhoto } from '../staff/my-photo';
import { isRep } from '../state/phase';
import { useSignedIn } from '../state/session';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { HeaderIconButton, StoreHeaderBand } from '../ui/store-header';
import { Text } from '../ui/text';

const AVATAR = 44;

/**
 * The blue top of «Байгууллага»: the person's round photo (it opens their profile), the greeting
 * by the hour over their name, and the bell with its unread count, as on «Нүүр».
 */
export function OrgHeader() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const feed = useFeed();
  const notifications = useNotificationSummary(rep);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const bell = rep ? (notifications.data?.unread ?? 0) : feedCount(feed.data);

  return (
    <StoreHeaderBand>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${me.fullName}, ${t('mobile.tabs.profile')}`}
          onPress={() => router.push(rep ? '/profile' : '/me')}
          style={({ pressed }) => [styles.person, pressed && styles.pressed]}
        >
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
            <MyPhoto size={AVATAR} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.greeting} numberOfLines={1}>
              {t(`mobile.staffHome.greeting.${greetingOf(clock)}`)}
            </Text>
            <Text style={styles.name} numberOfLines={1}>
              {firstNameOf(me.fullName)}
            </Text>
          </View>
        </Pressable>
        <HeaderIconButton
          icon={<Bell size={23} strokeWidth={1.9} color={colors.primaryForeground} />}
          label={
            bell > 0
              ? t('mobile.notifications.bellUnread', { n: bell })
              : t('mobile.notifications.title')
          }
          badge={bell}
          onPress={() => router.push(rep ? '/notifications' : '/community')}
        />
      </View>
    </StoreHeaderBand>
  );
}

/** The two parts of the page under the header, each underlined when chosen. */
export function OrgTopTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; Icon: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {options.map(({ value: option, label, Icon }) => {
        const on = option === value;
        const color = on ? colors.primary : colors.muted;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={styles.tabLabel}>
              <Icon size={18} strokeWidth={on ? 2.2 : 1.9} color={color} />
              <Text style={[styles.tabText, { color }, on && styles.tabTextOn]} numberOfLines={1}>
                {label}
              </Text>
            </View>
            <View style={[styles.underline, on && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: 6,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  person: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: colors.dotOnImageIdle,
    backgroundColor: colors.onPrimaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { ...type.heading, fontFamily: fonts.semibold, color: colors.primaryForeground },
  greeting: { ...type.secondary, color: colors.primaryForeground, opacity: 0.82 },
  name: { ...type.title3, color: colors.primaryForeground },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.input,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 48 },
  tabLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { ...type.chip },
  tabTextOn: { fontFamily: fonts.semibold },
  underline: { alignSelf: 'stretch', height: 2.5, marginHorizontal: spacing.xl },
  underlineOn: { backgroundColor: colors.primary, borderRadius: 2 },
});
