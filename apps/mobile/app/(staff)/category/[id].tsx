import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight, PackageSearch } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useRepCategoryPage } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { BannerCarousel, SectionRow, SubcategoryTile } from '../../../src/customer/home-parts';
import { sectionRouteOf } from '../../../src/customer/home-sections';
import { formatCount } from '../../../src/format/format';
import { useCartHost } from '../../../src/shop/list-qty-sheet';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { Card } from '../../../src/ui/staff-kit';
import { HeaderCart, StoreHeader } from '../../../src/ui/store-header';

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
  const host = useCartHost(server);
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
    <Page edges={[]}>
      <StoreHeader
        title={data ? data.category.name : ''}
        subtitle={
          data ? t('mobile.customer.list.count', { n: formatCount(data.productCount) }) : null
        }
        onBack={() => router.back()}
        right={<HeaderCart />}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {data ? (
          <>
            {data.banners.length > 0 ? (
              <BannerCarousel banners={data.banners} server={server} inset={spacing.lg} />
            ) : null}

            {data.subcategories.length > 0 ? (
              <Card flush style={styles.side}>
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
              </Card>
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
                    {...host.cardProps(product)}
                    {...size}
                  />
                )}
                onMore={() => router.push(sectionRouteOf(section.key, data.category.id))}
              />
            ))}

            <PillButton
              title={t('mobile.customer.category.all', { n: formatCount(data.productCount) })}
              variant="soft"
              trailing={<ArrowRight size={20} strokeWidth={2.2} color={colors.link} />}
              onPress={() => shop(data.category.id)}
              style={styles.side}
            />
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
      {host.sheet}
    </Page>
  );
}

const styles = StyleSheet.create({
  // 16 px between blocks; a block keeps 16 px from the edges, a strip of cards runs to them.
  body: { paddingTop: spacing.lg, paddingBottom: 40, gap: spacing.lg },
  side: { marginHorizontal: spacing.lg },
  subs: { gap: spacing.sm, padding: spacing.md },
  loading: { marginTop: spacing.xxl },
  problem: { marginTop: 0, marginHorizontal: spacing.lg },
});
