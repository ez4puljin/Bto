import { useRouter } from 'expo-router';
import { Bell, ChevronRight, PackageSearch, ScanBarcode, Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type StoreHomeCategory, useStoreHome, useStoreMe } from '../../../src/api/customer';
import { useStoreNotificationSummary } from '../../../src/api/customer-notifications';
import { problemFrom } from '../../../src/api/problem';
import {
  BannerCarousel,
  CategoryTile,
  SectionRow,
  useCardActions,
  useSectionText,
} from '../../../src/customer/home-parts';
import {
  type ChipTone,
  chipToneOf,
  homeCategoriesOf,
  sectionRouteOf,
} from '../../../src/customer/home-sections';
import { initialsOf } from '../../../src/format/format';
import { useCustomer } from '../../../src/state/session';
import { colors, fonts, spacing, TOUCH, type } from '../../../src/theme/tokens';
import { BrandMark } from '../../../src/ui/brand';
import { CountBadge, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';

const CHIP_TONES: Record<ChipTone, { background: string; text: string }> = {
  promotion: { background: colors.warningSoft, text: colors.warningText },
  discount: { background: colors.destructiveSoft, text: colors.destructiveText },
  new: { background: colors.secondary, text: colors.newBadge },
  plain: { background: colors.canvas, text: colors.foreground },
};

/**
 * «Нүүр» of «Bto300» as a shop window (ADR-0092 #1; the Main board): the mark, the bell and the
 * store's initials (its profile); the search that opens «Бараа» and the scanner; a chip per
 * section; the banners; «Ангиллын жагсаалт»; then the sections in the server's fixed order, each a
 * row of cards and › to its full list. The debt, the cart, recent orders and the contacts live on
 * «Тооцоо», «Сагс», «Захиалга» and «Профайл» (ADR-0092 #8).
 */
export default function CustomerHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const { me } = useCustomer();
  const storeMe = useStoreMe();
  const store = storeMe.data ?? me.store;
  const summary = useStoreNotificationSummary();
  const unread = summary.data?.unread ?? 0;
  const home = useStoreHome();
  const actions = useCardActions();
  const sectionText = useSectionText();
  const [refreshing, setRefreshing] = useState(false);
  const data = home.data;
  const sections = data?.sections ?? [];
  const categories = homeCategoriesOf(data?.categories ?? []);
  const empty =
    data !== undefined &&
    data.banners.length === 0 &&
    data.categories.length === 0 &&
    data.sections.length === 0;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([home.refetch(), summary.refetch(), storeMe.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Four tiles a row; the last row keeps its tiles at their place.
  const rows: (StoreHomeCategory | null)[][] = [];
  for (let at = 0; at < categories.length; at += 4) {
    const row: (StoreHomeCategory | null)[] = categories.slice(at, at + 4);
    while (row.length < 4) row.push(null);
    rows.push(row);
  }

  return (
    <Page white>
      <ScrollView
        contentContainerStyle={{ paddingBottom: inset + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.bar}>
          <BrandMark style={styles.grow} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            onPress={() => router.push('/notifications')}
            style={styles.icon}
          >
            <Bell size={24} strokeWidth={1.9} color={colors.foreground} />
            <CountBadge count={unread} style={styles.bellBadge} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.tabs.profile')}
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(store.name)}</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={t('mobile.shop.searchLabel')}
            onPress={() => router.navigate({ pathname: '/shop', params: { search: '1' } })}
            style={styles.search}
          >
            <Search size={18} strokeWidth={2.2} color={colors.muted} />
            <Text style={styles.searchText} numberOfLines={1}>
              {t('mobile.customer.home.search')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
            style={styles.scan}
          >
            <ScanBarcode size={22} strokeWidth={1.9} color={colors.foreground} />
          </Pressable>
        </View>

        {sections.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={t('mobile.customer.home.quickLinks')}
            contentContainerStyle={styles.chips}
          >
            {sections.map((section) => {
              const tone = CHIP_TONES[chipToneOf(section.kind)];
              return (
                <Pressable
                  key={section.key}
                  accessibilityRole="link"
                  onPress={() => router.push(sectionRouteOf(section.key))}
                  style={[styles.chip, { backgroundColor: tone.background }]}
                >
                  <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
                    {sectionText(section).title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {data ? <BannerCarousel banners={data.banners} /> : null}

        {rows.length > 0 ? (
          <>
            <View style={styles.categoriesHead}>
              <Text accessibilityRole="header" style={[type.title3, styles.grow]}>
                {t('mobile.customer.home.categories')}
              </Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('mobile.customer.home.allCategories')}
                onPress={() => router.push('/categories')}
                hitSlop={8}
                style={styles.all}
              >
                <Text style={styles.allText}>{t('mobile.home.seeAll')}</Text>
                <ChevronRight size={16} strokeWidth={2.4} color={colors.primary} />
              </Pressable>
            </View>
            <View style={styles.grid}>
              {rows.map((row, index) => (
                <View key={index} style={styles.gridRow}>
                  {row.map((category, at) =>
                    category ? (
                      <CategoryTile
                        key={category.id}
                        category={category}
                        onPress={() => router.push(`/category/${category.id}`)}
                      />
                    ) : (
                      <View key={`empty-${at}`} style={styles.grow} />
                    ),
                  )}
                </View>
              ))}
            </View>
          </>
        ) : null}

        {sections.map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            actions={actions}
            onMore={() => router.push(sectionRouteOf(section.key))}
          />
        ))}

        {home.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : home.error ? (
          <ProblemText problem={problemFrom(home.error)} style={styles.problem} />
        ) : empty ? (
          <View style={styles.empty}>
            <EmptyState
              icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.customer.home.empty')}
              hint={t('mobile.customer.home.emptyHint')}
            />
            <PillButton
              title={t('mobile.tabs.shop')}
              variant="soft"
              height={44}
              onPress={() => router.navigate('/shop')}
            />
          </View>
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  bar: {
    height: TOUCH,
    marginTop: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 3, right: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: spacing.xs,
    backgroundColor: colors.tint.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPressed: { opacity: 0.8 },
  avatarText: { ...type.rowStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: 10,
    paddingHorizontal: spacing.lg,
  },
  search: {
    flex: 1,
    height: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.canvas,
  },
  searchText: { ...type.field, flex: 1, color: colors.muted },
  scan: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center' },
  chipText: { ...type.bodyStrong },
  categoriesHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: spacing.lg,
  },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  allText: { ...type.row, color: colors.primary },
  grid: { gap: 14, paddingHorizontal: spacing.md },
  gridRow: { flexDirection: 'row', gap: spacing.sm },
  loading: { marginTop: spacing.xxl },
  problem: { marginTop: spacing.lg, marginHorizontal: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
});
