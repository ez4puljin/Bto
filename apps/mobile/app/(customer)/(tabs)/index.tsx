import { useRouter } from 'expo-router';
import { Bell, PackageSearch, ScanLine } from 'lucide-react-native';
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
  ListHeading,
  SectionRow,
  useCardActions,
  useSectionText,
} from '../../../src/customer/home-parts';
import { homeCategoriesOf, sectionRouteOf } from '../../../src/customer/home-sections';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { initialsOf } from '../../../src/format/format';
import { useCustomer } from '../../../src/state/session';
import { colors, fonts, spacing, storeType, TOUCH } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Text } from '../../../src/ui/text';

/**
 * «Нүүр» of «Bto300» as a shop window (ADR-0092 #1) in the E-mart structure (ADR-0095): the blue
 * header with «Bto300», the search (the scanner in it), the bell and the store's initials, and
 * the sections' names as links under them; the banners edge to edge; «АНГИЛЛЫН ЖАГСААЛТ»; then
 * the sections in the server's fixed order, each a row of cards and › to its full list.
 */
export default function CustomerHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
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
    <Page white edges={[]}>
      <StoreHeaderBand>
        <View style={styles.bar}>
          <Text accessibilityRole="header" style={storeType.wordmark}>
            {t('mobile.customer.appName')}
          </Text>
          <View style={styles.search}>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel={t('mobile.shop.searchLabel')}
              onPress={() => router.navigate({ pathname: '/shop', params: { search: '1' } })}
              style={styles.searchText}
            >
              <Text style={storeType.search} numberOfLines={1}>
                {t('mobile.customer.home.search')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.scan.title')}
              onPress={() => router.push('/scan')}
              hitSlop={6}
              style={styles.searchScan}
            >
              <ScanLine size={19} strokeWidth={1.8} color={colors.label2} />
            </Pressable>
          </View>
          <HeaderIconButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.primaryForeground} />}
            label={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            badge={unread}
            onPress={() => router.push('/notifications')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.tabs.profile')}
            onPress={() => router.push('/profile')}
            hitSlop={7}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(store.name)}</Text>
          </Pressable>
        </View>
        {sections.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={t('mobile.customer.home.quickLinks')}
            contentContainerStyle={styles.links}
          >
            {sections.map((section) => (
              <Pressable
                key={section.key}
                accessibilityRole="link"
                onPress={() => router.push(sectionRouteOf(section.key))}
                hitSlop={8}
              >
                <Text style={[storeType.headerLink, styles.upper]} numberOfLines={1}>
                  {sectionText(section).title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.noLinks} />
        )}
      </StoreHeaderBand>

      <ScrollView
        contentContainerStyle={{ paddingBottom: inset + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {data ? <BannerCarousel banners={data.banners} /> : null}

        {rows.length > 0 ? (
          <>
            <View style={styles.categoriesHead}>
              <ListHeading
                big
                title={t('mobile.customer.home.categories')}
                label={t('mobile.customer.home.allCategories')}
                onPress={() => router.push('/categories')}
              />
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
            <View style={styles.divider} />
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
  upper: { textTransform: 'uppercase' },
  pressed: { opacity: 0.7 },
  bar: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 14,
    paddingRight: spacing.sm,
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: 34,
    marginLeft: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  searchText: { flex: 1, height: TOUCH, justifyContent: 'center', paddingLeft: 14 },
  searchScan: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...storeType.badge, fontFamily: fonts.bold, color: colors.primary },
  links: { gap: 20, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 14 },
  noLinks: { height: spacing.sm },
  categoriesHead: { paddingTop: 12 },
  grid: { gap: 12, paddingHorizontal: 6 },
  gridRow: { flexDirection: 'row', gap: spacing.xs },
  divider: { height: 2, marginTop: 16, marginHorizontal: 10, backgroundColor: colors.border },
  loading: { marginTop: spacing.xxl },
  problem: { marginTop: spacing.lg, marginHorizontal: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
});
