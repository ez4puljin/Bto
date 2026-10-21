import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, Package, ShoppingCart } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  type StoreBanner,
  type StoreHomeCategory,
  type StoreHomeSection,
  type StoreProduct,
  useToggleFavourite,
} from '../api/customer';
import { lineOf } from '../cart/cart';
import { pageAt } from '../images/pictures';
import { useCustomer } from '../state/session';
import { useShop } from '../state/shop';
import { colors, fonts, spacing, TOUCH, type } from '../theme/tokens';
import { CountBadge } from '../ui/controls';
import { Text } from '../ui/text';
import {
  BANNER_SECONDS,
  bannerTargetOf,
  nextSlide,
  type SectionPlace,
  sectionSubtitleOf,
  sectionTitleOf,
} from './home-sections';
import { CustomerProductCard } from './product-card';
import { useAddOneStore } from './use-add';

// The parts «Нүүр», a section's full list and a category's page share (ADR-0092; the Main,
// SectionList and Category boards): a product card wired to the cart and ♡, a section's row, the
// banner carousel, the category tiles and the cart button of a pushed page.

/** What a card does: open the product, «+» one of its default unit, ♡. */
export function useCardActions() {
  const router = useRouter();
  const { server } = useCustomer();
  const { cart, pending } = useShop();
  const favourite = useToggleFavourite();
  const add = useAddOneStore();
  return {
    server,
    locked: pending !== null,
    lineOf: (productId: number) => lineOf(cart, productId),
    open: (product: StoreProduct) => router.push(`/product/${product.id}`),
    add,
    favourite: (product: StoreProduct) =>
      favourite.mutate({ productId: product.id, favourite: !product.favourite }),
  };
}

type CardActions = ReturnType<typeof useCardActions>;

/** A product card with the app's actions. */
export function StoreCard({
  product,
  actions,
  width,
  pictureHeight,
}: {
  product: StoreProduct;
  actions: CardActions;
  width?: number;
  pictureHeight?: number;
}) {
  return (
    <CustomerProductCard
      product={product}
      server={actions.server}
      line={actions.lineOf(product.id)}
      locked={actions.locked}
      onOpen={() => actions.open(product)}
      onAdd={() => actions.add(product)}
      onFavourite={() => actions.favourite(product)}
      {...(width !== undefined ? { width } : {})}
      {...(pictureHeight !== undefined ? { pictureHeight } : {})}
    />
  );
}

/** A section's title and the line under it, in words. */
export function useSectionText() {
  const { t } = useTranslation();
  return (
    section: Pick<StoreHomeSection, 'kind' | 'title' | 'subtitle' | 'lastDay'>,
    place: SectionPlace = 'home',
  ): { title: string; subtitle: string | null } => {
    const title = sectionTitleOf(section, place);
    const subtitle = sectionSubtitleOf(section, place);
    return {
      title: title.kind === 'own' ? title.text : t(`mobile.customer.sections.${title.name}.title`),
      subtitle:
        subtitle === null
          ? null
          : subtitle.kind === 'own'
            ? subtitle.text
            : subtitle.name === 'promotions' && subtitle.date
              ? t('mobile.customer.sections.promotions.until', { date: subtitle.date })
              : t(`mobile.customer.sections.${subtitle.name}.subtitle`),
    };
  };
}

/** The 152 px cards of a home row (the Main board). */
export const ROW_CARD_WIDTH = 152;

/**
 * A section of «Нүүр» or a category page: its title and line, › to its full list, and up to 10
 * cards in a row.
 */
export function SectionRow({
  section,
  place = 'home',
  actions,
  onMore,
}: {
  section: StoreHomeSection;
  place?: SectionPlace;
  actions: CardActions;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const sectionText = useSectionText();
  const text = sectionText(section, place);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={type.title3} numberOfLines={2}>
            {text.title}
          </Text>
          {text.subtitle ? (
            <Text style={[type.body, styles.muted]} numberOfLines={2}>
              {text.subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.customer.home.seeAll', { title: text.title })}
          onPress={onMore}
          style={styles.more}
        >
          <ChevronRight size={22} strokeWidth={2.2} color={colors.foreground} />
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={section.products}
        keyExtractor={(product) => String(product.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cards}
        initialNumToRender={3}
        renderItem={({ item }) => (
          <StoreCard product={item} actions={actions} width={ROW_CARD_WIDTH} pictureHeight={128} />
        )}
      />
    </View>
  );
}

/**
 * The banners (ADR-0092 #5): 2:1 pictures one at a time, swiped or moved on every five seconds
 * (the owner, 2026-10-20) — never while a finger is on them; the dots below choose one. A tap opens
 * its link: a segment's list, a category's page or a product.
 */
export function BannerCarousel({ banners }: { banners: readonly StoreBanner[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useCustomer();
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [slide, setSlide] = useState(0);
  const [touching, setTouching] = useState(false);
  const count = banners.length;

  useEffect(() => {
    if (count <= 1 || width <= 0 || touching) return;
    const timer = setTimeout(() => {
      const next = nextSlide(slide, count);
      scroller.current?.scrollTo({ x: next * width, animated: true });
      setSlide(next);
    }, BANNER_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [slide, count, width, touching]);

  if (count === 0) return null;
  const go = (index: number) => {
    scroller.current?.scrollTo({ x: index * width, animated: true });
    setSlide(index);
  };

  return (
    <View style={styles.banners}>
      <View style={styles.bannerBox} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={() => setTouching(true)}
            onScrollEndDrag={() => setTouching(false)}
            onMomentumScrollEnd={(event) =>
              setSlide(pageAt(event.nativeEvent.contentOffset.x, width, count))
            }
          >
            {banners.map((banner) => {
              const target = bannerTargetOf(banner.link);
              return (
                <Pressable
                  key={banner.id}
                  accessibilityRole={target ? 'link' : 'image'}
                  accessibilityLabel={banner.title}
                  disabled={!target}
                  onPress={() => {
                    if (target) router.push(target);
                  }}
                  style={{ width, height: width / 2 }}
                >
                  {banner.imageUrl ? (
                    <Image
                      source={{ uri: `${server}${banner.imageUrl}` }}
                      style={styles.bannerImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={banner.imageUrl}
                      transition={120}
                    />
                  ) : (
                    <View style={styles.bannerFallback}>
                      <Text style={styles.bannerTitle} numberOfLines={3}>
                        {banner.title}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
      {count > 1 ? (
        <View accessibilityLabel={t('mobile.customer.home.banners')} style={styles.dots}>
          {banners.map((banner, index) => (
            <Pressable
              key={banner.id}
              accessibilityRole="button"
              accessibilityLabel={t('mobile.customer.home.bannerDot', { n: index + 1 })}
              accessibilityState={{ selected: index === slide }}
              onPress={() => go(index)}
              style={styles.dotButton}
            >
              <View style={[styles.dot, index === slide && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A category's picture: its own, or one of its products', or a box. */
function CategoryPicture({
  category,
  size,
}: {
  category: Pick<StoreHomeCategory, 'imageUrl'>;
  size: number;
}) {
  const { server } = useCustomer();
  return category.imageUrl ? (
    <Image
      source={{ uri: `${server}${category.imageUrl}` }}
      style={{ width: size, height: size }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={category.imageUrl}
    />
  ) : (
    <Package size={size * 0.45} strokeWidth={1.4} color={colors.input} />
  );
}

/** «Ангиллын жагсаалт»'s tile: a rounded square picture and the name under it. */
export function CategoryTile({
  category,
  onPress,
}: {
  category: StoreHomeCategory;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.tile}>
      <View style={styles.tilePicture}>
        <CategoryPicture category={category} size={68} />
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {category.name}
      </Text>
    </Pressable>
  );
}

/** A subcategory on a category's page: a round picture and the name. */
export function RoundCategory({
  category,
  onPress,
}: {
  category: StoreHomeCategory;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.round}>
      <View style={styles.roundPicture}>
        <CategoryPicture category={category} size={64} />
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {category.name}
      </Text>
    </Pressable>
  );
}

/** The cart on a pushed page's bar, with its count; it opens «Сагс». */
export function CartButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const { cart } = useShop();
  const n = cart.lines.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.customer.list.cart', { n })}
      onPress={() => router.navigate('/cart')}
      style={styles.cart}
    >
      <ShoppingCart size={23} strokeWidth={1.8} color={colors.foreground} />
      <CountBadge count={n} style={styles.cartBadge} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  muted: { color: colors.muted },
  section: { paddingTop: 22 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 6,
    paddingBottom: 10,
  },
  more: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  cards: { gap: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  banners: { paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  bannerBox: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.imageFill,
    aspectRatio: 2,
  },
  bannerImage: { width: '100%', height: '100%' },
  bannerFallback: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: colors.primary,
  },
  bannerTitle: { ...type.title2, color: colors.primaryForeground },
  dots: { flexDirection: 'row', justifyContent: 'center', marginTop: 2 },
  dotButton: { width: 30, height: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.input },
  dotOn: { width: 22, backgroundColor: colors.primary },
  tile: { flex: 1, alignItems: 'center', gap: 6 },
  tilePicture: {
    width: 68,
    height: 68,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: {
    ...type.secondary,
    fontFamily: fonts.medium,
    color: colors.foreground,
    textAlign: 'center',
    minHeight: 32,
  },
  round: { width: 76, alignItems: 'center', gap: 6 },
  roundPicture: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cart: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  cartBadge: { position: 'absolute', top: 2, right: 0 },
});
