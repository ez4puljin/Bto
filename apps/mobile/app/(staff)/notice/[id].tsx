import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BellOff, Package } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { useMarkRead, useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import { useProductsOf } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { KIND_STYLES, useNoticeEyebrow } from '../../../src/notifications/kinds';
import { useAddOne } from '../../../src/shop/use-add';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { NavBar, Page, SectionHeader } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';

const GAP = 12;

/**
 * A notice opened from the popup or the list (ADR-0062 #3): its picture and words, then its
 * products in the admin's order, as cards of «Бараа» (ADR-0066).
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
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;

  return (
    <Page white>
      <NavBar back={t('common.back')} onBack={() => router.back()} />
      <View style={styles.pad}>
        {summary.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {summary.error ? <ProblemText problem={problemFrom(summary.error)} /> : null}
        {summary.isSuccess && !notice ? (
          <EmptyState
            icon={<BellOff size={40} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.notifications.gone')}
          />
        ) : null}
      </View>
      {notice ? (
        <ScrollView contentContainerStyle={styles.body}>
          {notice.imageUrl ? (
            <Image
              source={{ uri: `${server}${notice.imageUrl}` }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <Text style={[styles.eyebrow, { color: KIND_STYLES[notice.kind].strong }]}>
            {eyebrow(notice)}
          </Text>
          <Text accessibilityRole="header" style={type.title2}>
            {notice.title}
          </Text>
          <Text style={styles.text}>{notice.body}</Text>
          {productIds.length > 0 ? (
            <>
              <SectionHeader>{t('mobile.notifications.products')}</SectionHeader>
              {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
              {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
              {query.isSuccess && products.length === 0 ? (
                <EmptyState
                  icon={<Package size={40} strokeWidth={1.5} color={colors.input} />}
                  title={t('mobile.notifications.productsGone')}
                />
              ) : null}
              <View style={styles.grid}>
                {products.map((product) => (
                  <View key={product.id} style={{ width: cardWidth }}>
                    <ProductCard
                      product={product}
                      server={server}
                      line={lineOf(cart, product.id)}
                      locked={pending !== null}
                      onOpen={() => router.push(`/product/${product.id}`)}
                      onAdd={() => add(product)}
                    />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40, gap: 6 },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.tile,
    backgroundColor: colors.imageFill,
    marginBottom: spacing.sm,
  },
  eyebrow: { ...type.chip, fontFamily: fonts.bold },
  text: { ...type.row, color: colors.label2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 22 },
});
