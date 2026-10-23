import { useLocalSearchParams, useRouter } from 'expo-router';
import { PackageSearch } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useRepCategoryPage } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { BannerCarousel, SectionRow, SubcategoryTile } from '../../../src/customer/home-parts';
import { sectionRouteOf } from '../../../src/customer/home-sections';
import { formatCount } from '../../../src/format/format';
import { useAddOne } from '../../../src/shop/use-add';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, storeType } from '../../../src/theme/tokens';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * A category's page in the rep app (ADR-0100 #9, «Bto300»'s Category board): the category and its
 * count, its banners, its subcategories as pictures (a tap opens «Бараа» filtered to one), its new
 * products and deals as rows of the rep's cards, and «Ангиллын бүх бараа · N», which opens «Бараа»
 * filtered to it.
 */
export default function RepCategoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const parsed = parseInt(String(params.id ?? ''), 10);
  const id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const page = useRepCategoryPage(id);
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const add = useAddOne();
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
    <Page white edges={[]}>
      <StoreHeader
        title={
          data
            ? t('mobile.customer.list.titleCount', {
                title: data.category.name,
                n: formatCount(data.productCount),
              })
            : ''
        }
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {data ? (
          <>
            <BannerCarousel banners={data.banners} server={server} />

            {data.subcategories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.subs}
              >
                {data.subcategories.map((sub) => (
                  <SubcategoryTile
                    key={sub.id}
                    category={sub}
                    server={server}
                    onPress={() => shop(sub.id)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {data.sections.map((section) => (
              <SectionRow
                key={section.key}
                section={section}
                place="category"
                renderCard={(product, size) => (
                  <ProductCard
                    product={product}
                    server={server}
                    line={lineOf(cart, product.id)}
                    locked={pending !== null}
                    onOpen={() => router.push(`/product/${product.id}`)}
                    onAdd={() => add(product)}
                    {...size}
                  />
                )}
                onMore={() => router.push(sectionRouteOf(section.key, data.category.id))}
              />
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => shop(data.category.id)}
              style={({ pressed }) => [styles.all, pressed && styles.allPressed]}
            >
              <Text style={[storeType.wideButton, styles.upper]} numberOfLines={1}>
                {t('mobile.customer.category.all', { n: formatCount(data.productCount) })}
              </Text>
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
  upper: { textTransform: 'uppercase' },
  subs: { gap: spacing.md, paddingTop: 14, paddingHorizontal: 14 },
  all: {
    height: 44,
    marginTop: 22,
    marginHorizontal: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allPressed: { backgroundColor: colors.fill },
  loading: { marginTop: spacing.xxl },
  problem: { marginTop: spacing.lg, marginHorizontal: spacing.lg },
});
