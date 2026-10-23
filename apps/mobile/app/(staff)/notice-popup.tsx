import { addDays } from '@tugeel/shared/time';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { type MyNotice, useMarkRead, useNotificationSummary } from '../../src/api/notifications';
import { type RepProduct, useProductsOf } from '../../src/api/rep';
import { formatMnt } from '../../src/format/format';
import {
  dropPercent,
  idsParam,
  percentIn,
  popupQueue,
  replayQueue,
} from '../../src/notifications/feed';
import { KIND_STYLES, KindIcon, useNoticeEyebrow } from '../../src/notifications/kinds';
import { useSignedIn } from '../../src/state/session';
import { colors, fonts, radii, shadows, spacing, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { useToast } from '../../src/ui/toast';

/** Products a price-drop notice lists on its card. */
const LISTED = 3;

/**
 * The notices that pop up when the app opens (the Launch board; ADR-0062 #3, ADR-0068 #8; drawn as
 * «Bto300»'s popup since ADR-0100), one at a time in the middle of the screen: a picture by kind,
 * the kind and days on a chip, the title, the text, a price drop's old and new prices, the dots,
 * then «Хаах» and «Дараагийнх» — on the last one «Бараа харах» when it lists products (before the
 * last, its products are a link above the buttons). A notice counts as read once shown. After the
 * last, a toast says they are kept under the bell and offers them again («Дахин харах», `?ids=`).
 */
export default function NoticePopup() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ ids?: string }>();
  const summary = useNotificationSummary();
  const { mutate: markRead } = useMarkRead();
  const eyebrow = useNoticeEyebrow();
  // The queue as it was when the popup opened: reading one does not reorder the rest.
  const [queue] = useState(() => {
    const notices = summary.data?.notices ?? [];
    const replay = idsParam(params.ids);
    return replay.length > 0 ? replayQueue(notices, replay) : popupQueue(notices);
  });
  const [index, setIndex] = useState(0);
  const notice = queue[index];
  const noticeId = notice?.id ?? null;

  useEffect(() => {
    if (noticeId === null) router.back();
    else if (!notice?.read) markRead({ noticeIds: [noticeId] });
  }, [noticeId, notice?.read, markRead, router]);

  if (!notice) return null;
  const hasNext = index + 1 < queue.length;
  const close = () => {
    const ids = queue.map((entry) => entry.id).join(',');
    router.back();
    toast.show({
      message: t('mobile.notifications.kept'),
      action: {
        label: t('mobile.notifications.again'),
        onPress: () => router.push(`/notice-popup?ids=${ids}`),
      },
    });
  };
  const viewProducts = () => router.replace(`/notice/${notice.id}`);

  return (
    <View style={styles.backdrop}>
      <View style={styles.card} accessibilityViewIsModal accessibilityLabel={notice.title}>
        <NoticeCard
          notice={notice}
          eyebrow={eyebrow(notice)}
          onClose={close}
          footer={
            <>
              {queue.length > 1 ? (
                <View style={styles.dots}>
                  {queue.map((entry, at) => (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.notifications.counter', {
                        n: at + 1,
                        total: queue.length,
                      })}
                      onPress={() => setIndex(at)}
                      hitSlop={8}
                      style={[styles.dot, at === index && styles.dotOn]}
                    />
                  ))}
                </View>
              ) : null}
              {hasNext && notice.productIds.length > 0 ? (
                // Not the last one: its products stay one tap away above the pager's buttons.
                <Pressable accessibilityRole="button" onPress={viewProducts} style={styles.link}>
                  <Text style={[type.row, styles.linkText]}>
                    {t(`mobile.notifications.cta.${notice.kind}`)}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.buttons}>
                <Pressable
                  accessibilityRole="button"
                  onPress={close}
                  style={({ pressed }) => [
                    styles.button,
                    styles.closeButton,
                    pressed && styles.closePressed,
                  ]}
                >
                  <Text style={type.button} numberOfLines={1}>
                    {t('mobile.notifications.close')}
                  </Text>
                </Pressable>
                {hasNext ? (
                  <PillButton
                    height={48}
                    style={styles.button}
                    title={t('mobile.notifications.next')}
                    onPress={() => setIndex(index + 1)}
                  />
                ) : notice.productIds.length > 0 ? (
                  <PillButton
                    height={48}
                    style={styles.button}
                    title={t('mobile.notifications.viewProducts')}
                    accessibilityLabel={t(`mobile.notifications.cta.${notice.kind}`)}
                    onPress={viewProducts}
                  />
                ) : null}
              </View>
            </>
          }
        />
      </View>
    </View>
  );
}

/** One notice of the popup: the picture, the chip, the words, the prices, then the buttons. */
function NoticeCard({
  notice,
  eyebrow,
  onClose,
  footer,
}: {
  notice: MyNotice;
  eyebrow: string;
  onClose: () => void;
  footer: ReactNode;
}) {
  const { t } = useTranslation();
  const { server } = useSignedIn();
  const style = KIND_STYLES[notice.kind];
  const listed = notice.productIds.slice(0, LISTED);
  const products = useProductsOf(
    listed,
    notice.kind === 'PRICE_DROP' ? addDays(notice.validFrom, -1) : undefined,
  );
  const rows = (products.data ?? []).filter((product) => product.basePrice !== null);
  const first = products.data?.[0];
  const percent = notice.kind === 'PROMOTION' ? percentIn(`${notice.title} ${notice.body}`) : null;
  const drop = first ? dropPercent(first.basePriceBefore, first.basePrice) : null;
  const picture = (product: RepProduct | undefined) =>
    product?.images[0]?.url ?? product?.thumbUrl ?? null;

  return (
    <>
      <View style={[styles.hero, { backgroundColor: style.soft }]}>
        {notice.imageUrl ? (
          <Image
            source={{ uri: `${server}${notice.imageUrl}` }}
            style={styles.heroImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : notice.kind === 'PRICE_DROP' && picture(first) ? (
          <Image
            source={{ uri: `${server}${picture(first) ?? ''}` }}
            style={styles.heroProduct}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        ) : notice.kind === 'NEW_PRODUCT' && (products.data?.length ?? 0) > 0 ? (
          <View style={styles.tiles}>
            {(products.data ?? []).slice(0, 3).map((product) => (
              <View key={product.id} style={styles.tile}>
                {product.thumbUrl ? (
                  <Image
                    source={{ uri: `${server}${product.thumbUrl}` }}
                    style={styles.tileImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <Package size={36} strokeWidth={1.5} color={colors.input} />
                )}
              </View>
            ))}
          </View>
        ) : percent ? (
          <View style={styles.percent}>
            <Text style={[styles.percentText, { color: style.strong }]}>{`${percent}%`}</Text>
            <Text style={styles.percentLabel}>{t('mobile.notifications.discount')}</Text>
          </View>
        ) : (
          <View style={styles.kindIcon}>
            <KindIcon kind={notice.kind} size={44} />
          </View>
        )}
        {notice.kind === 'PRICE_DROP' && drop && !notice.imageUrl ? (
          <View style={[styles.flag, styles.flagRed]}>
            <Text style={styles.flagText}>{`-${drop}%`}</Text>
          </View>
        ) : null}
        {notice.kind === 'NEW_PRODUCT' && !notice.imageUrl ? (
          <View style={[styles.flag, styles.flagGreen]}>
            <Text style={styles.flagText}>{t('mobile.shop.new')}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.notifications.close')}
          onPress={onClose}
          hitSlop={8}
          style={styles.close}
        >
          <X size={14} strokeWidth={3} color={colors.label2} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
        <View style={[styles.chip, { backgroundColor: style.soft }]}>
          <Text style={[styles.chipText, { color: style.strong }]} numberOfLines={1}>
            {eyebrow}
          </Text>
        </View>
        <Text style={styles.title}>{notice.title}</Text>
        <Text style={styles.body}>{notice.body}</Text>
        {notice.kind === 'PRICE_DROP' && rows.length > 0 ? (
          <View style={styles.prices}>
            {rows.map((product, at) => (
              <View key={product.id} style={[styles.priceRow, at > 0 && styles.priceLine]}>
                <Text style={styles.priceName} numberOfLines={1}>
                  {product.name}
                </Text>
                <View style={styles.priceValues}>
                  {product.basePriceBefore && product.basePriceBefore !== product.basePrice ? (
                    <Text style={styles.oldPrice}>
                      {t('pricing.money', { amount: formatMnt(product.basePriceBefore) })}
                    </Text>
                  ) : null}
                  <Text style={styles.newPrice}>
                    {t('pricing.money', { amount: formatMnt(product.basePrice ?? '0') })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {footer}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.popupBackdrop,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: '88%',
    borderRadius: radii.hero,
    backgroundColor: colors.card,
    overflow: 'hidden',
    boxShadow: shadows.popup,
  },
  hero: { height: 192, alignItems: 'center', justifyContent: 'center' },
  heroImage: { width: '100%', height: '100%' },
  heroProduct: { width: '80%', height: 176 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: '100%', height: '100%' },
  percent: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.card,
    boxShadow: shadows.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentText: type.display,
  percentLabel: { ...type.chip, color: colors.label2 },
  kindIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flag: {
    position: 'absolute',
    top: 18,
    left: 18,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: 'center',
  },
  flagRed: { backgroundColor: colors.destructive },
  flagGreen: { backgroundColor: colors.success },
  flagText: { ...type.bodyStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
  close: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.floatingFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  text: { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: spacing.sm },
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
  },
  chipText: { ...type.secondary, fontFamily: fonts.semibold },
  title: type.title3,
  body: { ...type.row, color: colors.label2 },
  prices: {
    borderRadius: 14,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
  },
  priceRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 14,
  },
  priceLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  priceName: { ...type.rowStrong, flex: 1 },
  priceValues: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  oldPrice: {
    ...type.chip,
    fontFamily: fonts.regular,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  newPrice: { ...type.rowStrong, fontFamily: fonts.bold, color: colors.cancelled },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.input },
  dotOn: { width: 20, backgroundColor: colors.primary },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.primary, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: spacing.xs },
  button: { flex: 1, paddingHorizontal: spacing.md },
  closeButton: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.closeFill,
  },
  closePressed: { backgroundColor: colors.fill },
});
