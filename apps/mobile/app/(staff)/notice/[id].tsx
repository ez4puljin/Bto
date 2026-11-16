import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BellOff,
  type LucideIcon,
  Megaphone,
  Package,
  PackagePlus,
  Tag,
  TrendingDown,
} from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { type MyNotice, useMarkRead, useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import { useProductsOf } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { useNoticeEyebrow } from '../../../src/notifications/kinds';
import { useAddOne } from '../../../src/shop/use-add';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { Card, PAGE, Pill, type Tone } from '../../../src/ui/staff-kit';
import { HeaderCart, StoreHeader } from '../../../src/ui/store-header';

const GAP = 12;

/** Each kind's pill: its tone and icon (the list's tiles and the popup use the same icons). */
const KIND_PILL: Record<MyNotice['kind'], { tone: Tone; icon: LucideIcon }> = {
  PROMOTION: { tone: 'warn', icon: Tag },
  PRICE_DROP: { tone: 'info', icon: TrendingDown },
  NEW_PRODUCT: { tone: 'ok', icon: PackagePlus },
  NEWS: { tone: 'info', icon: Megaphone },
};

/**
 * A notice opened from the popup or the list (ADR-0062 #3; the Notice board of 2026-11-16): under
 * the blue header with ← and the cart, one card with its picture, its kind and days on a pill and
 * its words, then its products in the admin's order, as cards of «Бараа» (ADR-0068) two by two.
 */
export default function NoticeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number.parseInt(id ?? '', 10);
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const add = useAddOne();
  const summary = useNotificationSummary();
  const { mutate: markRead } = useMarkRead();
  const eyebrow = useNoticeEyebrow();
  const notice = summary.data?.notices.find((entry) => entry.id === noticeId);
  const unread = notice !== undefined && !notice.read;
  useEffect(() => {
    if (unread) markRead({ noticeIds: [noticeId] });
  }, [unread, noticeId, markRead]);
  const productIds = notice?.productIds ?? [];
  const query = useProductsOf(productIds);
  // In the admin's order; a product no longer on sale is left out.
  const products = useMemo(() => {
    const found = new Map((query.data ?? []).map((product) => [product.id, product]));
    return (notice?.productIds ?? []).flatMap((productId) => {
      const product = found.get(productId);
      return product ? [product] : [];
    });
  }, [query.data, notice?.productIds]);
  const cardWidth = (width - PAGE.padding * 2 - GAP) / 2;

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.notifications.title')}
        onBack={() => router.back()}
        right={<HeaderCart />}
      />
      {notice ? null : (
        <View style={styles.pad}>
          {summary.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {summary.error ? (
            <ProblemText problem={problemFrom(summary.error)} style={styles.problem} />
          ) : null}
          {summary.isSuccess ? (
            <EmptyState
              icon={<BellOff size={36} strokeWidth={1.6} color={colors.muted} />}
              title={t('mobile.notifications.gone')}
            />
          ) : null}
        </View>
      )}
      {notice ? (
        <ScrollView contentContainerStyle={styles.body}>
          {summary.error ? (
            <ProblemText problem={problemFrom(summary.error)} style={styles.problem} />
          ) : null}
          <Card flush>
            {notice.imageUrl ? (
              <Image
                source={{ uri: `${server}${notice.imageUrl}` }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : null}
            <View style={styles.words}>
              <Pill
                tone={KIND_PILL[notice.kind].tone}
                icon={KIND_PILL[notice.kind].icon}
                label={eyebrow(notice)}
                style={styles.pill}
              />
              <Text accessibilityRole="header" style={type.title2}>
                {notice.title}
              </Text>
              <Text style={styles.text}>{notice.body}</Text>
            </View>
          </Card>
          {productIds.length > 0 ? (
            <View style={styles.block}>
              <SectionHeader
                style={styles.label}
                right={
                  products.length > 0 ? (
                    <Text style={type.secondary}>
                      {t('catalog.categories.products', { count: products.length })}
                    </Text>
                  ) : undefined
                }
              >
                {t('mobile.notifications.products')}
              </SectionHeader>
              {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
              {query.error ? (
                <ProblemText problem={problemFrom(query.error)} style={styles.problem} />
              ) : null}
              {query.isSuccess && products.length === 0 ? (
                <EmptyState
                  icon={<Package size={36} strokeWidth={1.6} color={colors.muted} />}
                  title={t('mobile.notifications.productsGone')}
                />
              ) : null}
              <View style={styles.grid}>
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    server={server}
                    line={lineOf(cart, product.id)}
                    locked={pending !== null}
                    onOpen={() => router.push(`/product/${product.id}`)}
                    onAdd={() => add(product)}
                    width={cardWidth}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  pad: { padding: PAGE.padding, gap: PAGE.gap },
  body: { ...PAGE, paddingBottom: 40 },
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  problem: { marginTop: 0 },
  image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.imageFill },
  words: { padding: spacing.lg, gap: spacing.sm },
  pill: { maxWidth: '100%' },
  text: { ...type.row, color: colors.label2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: GAP },
});
