import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BellOff, ChevronRight, Package } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useStoreProductsOf } from '../../../src/api/customer';
import {
  useStoreMarkRead,
  useStoreNotificationSummary,
} from '../../../src/api/customer-notifications';
import { problemFrom } from '../../../src/api/problem';
import { inOrderOf } from '../../../src/customer/home';
import { cardPictures } from '../../../src/images/pictures';
import { KIND_STYLES, useNoticeEyebrow } from '../../../src/notifications/kinds';
import { useCustomer } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { StoreHeader } from '../../../src/customer/store-header';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { usePriceParts } from '../../../src/ui/product-card';
import { Text } from '../../../src/ui/text';

/**
 * A notice opened from the popup or «Мэдэгдэл» (ADR-0079 #8): its picture and words, then its
 * products in the admin's order at today's price, each opening its page (where it goes into the
 * cart). A product no longer on sale is left out.
 */
export default function CustomerNoticeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number.parseInt(id ?? '', 10);
  const { server } = useCustomer();
  const summary = useStoreNotificationSummary();
  const { mutate: markRead } = useStoreMarkRead();
  const eyebrow = useNoticeEyebrow();
  const priceParts = usePriceParts();
  const notice = summary.data?.notices.find((entry) => entry.id === noticeId);
  const unread = notice !== undefined && !notice.read;
  useEffect(() => {
    if (unread) markRead({ noticeIds: [noticeId] });
  }, [unread, noticeId, markRead]);
  const productIds = notice?.productIds ?? [];
  const query = useStoreProductsOf(productIds);
  const products = inOrderOf(productIds, query.data ?? []);

  return (
    <Page white edges={[]}>
      <StoreHeader title={t('mobile.notifications.title')} onBack={() => router.back()} />
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
              {products.length > 0 ? (
                <Group inset={spacing.lg + 52 + spacing.md} style={styles.group}>
                  {products.map((product) => {
                    const picture = cardPictures(product)[0];
                    const price = priceParts(product);
                    return (
                      <Pressable
                        key={product.id}
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.shop.openProduct', { name: product.name })}
                        onPress={() => router.push(`/product/${product.id}`)}
                        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                      >
                        <View style={styles.thumb}>
                          {picture ? (
                            <Image
                              source={{ uri: `${server}${picture}` }}
                              style={styles.thumbImage}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              recyclingKey={picture}
                            />
                          ) : (
                            <Package size={24} strokeWidth={1.5} color={colors.input} />
                          )}
                        </View>
                        <View style={styles.rowText}>
                          <Text style={type.rowStrong} numberOfLines={2}>
                            {product.name}
                          </Text>
                          {price ? (
                            <Text style={styles.price} numberOfLines={1}>
                              {price.price}
                              <Text style={type.secondary}>{` ${price.per}`}</Text>
                            </Text>
                          ) : (
                            <Text style={type.secondary}>{t('mobile.shop.noPrice')}</Text>
                          )}
                        </View>
                        <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
                      </Pressable>
                    );
                  })}
                </Group>
              ) : null}
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
  group: { backgroundColor: colors.canvas },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.fill },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1, gap: 2 },
  price: { ...type.bodyStrong, ...tabular },
});
