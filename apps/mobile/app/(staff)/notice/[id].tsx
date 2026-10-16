import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BellOff, ChevronLeft, Package } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMarkRead, useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import { useProductsOf } from '../../../src/api/rep';
import { KIND_STYLES, useNoticeEyebrow } from '../../../src/notifications/kinds';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { EmptyState, ProblemText, Screen, SectionTitle } from '../../../src/ui/kit';
import { ProductRow } from '../../../src/ui/product-row';

/**
 * A notice opened from the popup or the list (ADR-0062 #3): its picture and text, then its
 * products in the admin's order, priced and stocked as in «Бараа», with − n + per unit.
 */
export default function NoticeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number.parseInt(id ?? '', 10);
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
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

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ChevronLeft size={24} color={colors.primary} />
        <Text style={[type.body, { color: colors.link }]}>{t('common.back')}</Text>
      </Pressable>
      {summary.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {summary.error ? <ProblemText problem={problemFrom(summary.error)} /> : null}
      {summary.isSuccess && !notice ? (
        <EmptyState
          icon={<BellOff size={40} color={colors.muted} />}
          title={t('mobile.notifications.gone')}
        />
      ) : null}
      {notice ? (
        <ScrollView contentContainerStyle={styles.body}>
          {notice.imageUrl ? (
            <Image
              source={{ uri: `${server}${notice.imageUrl}` }}
              style={styles.image}
              contentFit="cover"
            />
          ) : null}
          <Text style={[type.caption, { color: KIND_STYLES[notice.kind].strong }]}>
            {eyebrow(notice)}
          </Text>
          <Text style={type.title}>{notice.title}</Text>
          <Text style={type.body}>{notice.body}</Text>
          {productIds.length > 0 ? (
            <View style={styles.products}>
              <SectionTitle>{t('mobile.notifications.products')}</SectionTitle>
              {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
              {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
              {query.isSuccess && products.length === 0 ? (
                <EmptyState
                  icon={<Package size={40} color={colors.muted} />}
                  title={t('mobile.notifications.productsGone')}
                />
              ) : null}
              {products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  server={server}
                  cart={cart}
                  dispatch={dispatch}
                  locked={pending !== null}
                  onOpen={() => router.push(`/product/${product.id}`)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 44 },
  body: { padding: spacing.lg, gap: spacing.md },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.card,
    backgroundColor: colors.fill,
  },
  products: { gap: spacing.sm, marginTop: spacing.sm },
});
