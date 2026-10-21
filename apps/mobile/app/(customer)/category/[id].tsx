import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, PackageSearch } from 'lucide-react-native';
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
import { useStoreCategoryPage } from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import {
  BannerCarousel,
  CartButton,
  RoundCategory,
  SectionRow,
  useCardActions,
} from '../../../src/customer/home-parts';
import { sectionRouteOf } from '../../../src/customer/home-sections';
import { formatCount } from '../../../src/format/format';
import { colors, fonts, spacing, type } from '../../../src/theme/tokens';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, NavBar, Page } from '../../../src/ui/layout';
import { Text } from '../../../src/ui/text';

/**
 * «Ангиллын хуудас» (ADR-0092 #6; the Category board): the category and its count, its banners,
 * its subcategories as round pictures (a tap opens «Бараа» filtered to one, the owner 2026-10-20),
 * «Шинээр нэмэгдсэн бараа» and «Хямдралтай бараа» of its subtree, and «… бүх бараа · N», which
 * opens «Бараа» filtered to it.
 */
export default function CategoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const parsed = parseInt(String(params.id ?? ''), 10);
  const id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const page = useStoreCategoryPage(id);
  const actions = useCardActions();
  const [refreshing, setRefreshing] = useState(false);
  const data = page.data;
  const problem = page.error ? problemFrom(page.error) : null;

  const shop = (categoryId: number) =>
    router.navigate({ pathname: '/shop', params: { categoryIds: String(categoryId) } });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await page.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page white>
      <NavBar back={t('mobile.tabs.home')} onBack={() => router.back()} right={<CartButton />} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {data ? (
          <>
            <View style={styles.head}>
              <LargeTitle>{data.category.name}</LargeTitle>
              <Text style={[type.body, styles.muted]}>
                {t('mobile.customer.list.count', { n: formatCount(data.productCount) })}
              </Text>
            </View>

            <BannerCarousel banners={data.banners} />

            {data.subcategories.length > 0 ? (
              <>
                <Text accessibilityRole="header" style={[type.sectionTitle, styles.subTitle]}>
                  {t('mobile.customer.category.subcategories')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.subs}
                >
                  {data.subcategories.map((sub) => (
                    <RoundCategory key={sub.id} category={sub} onPress={() => shop(sub.id)} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            {data.sections.map((section) => (
              <SectionRow
                key={section.key}
                section={section}
                place="category"
                actions={actions}
                onMore={() => router.push(sectionRouteOf(section.key, data.category.id))}
              />
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => shop(data.category.id)}
              style={({ pressed }) => [styles.all, pressed && styles.allPressed]}
            >
              <Text style={styles.allText} numberOfLines={2}>
                {t('mobile.customer.category.all', {
                  name: data.category.name,
                  n: formatCount(data.productCount),
                })}
              </Text>
              <ChevronRight size={18} strokeWidth={2.4} color={colors.primary} />
            </Pressable>
          </>
        ) : page.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : problem?.status === 404 || id === null ? (
          <EmptyState
            icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.customer.category.gone')}
          />
        ) : problem ? (
          <ProblemText problem={problem} style={styles.problem} />
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 40 },
  head: { paddingTop: 2, paddingHorizontal: spacing.lg, gap: 2 },
  muted: { color: colors.muted },
  subTitle: { marginTop: 18, marginBottom: 10, marginHorizontal: spacing.lg },
  subs: { gap: spacing.md, paddingHorizontal: spacing.lg },
  all: {
    minHeight: 52,
    marginTop: 22,
    marginHorizontal: spacing.lg,
    paddingHorizontal: 20,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  allPressed: { backgroundColor: colors.secondary },
  allText: { ...type.button, fontFamily: fonts.semibold, color: colors.primary, flexShrink: 1 },
  loading: { marginTop: spacing.xxl },
  problem: { marginTop: spacing.lg, marginHorizontal: spacing.lg },
});
