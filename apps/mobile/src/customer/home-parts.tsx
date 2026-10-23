import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  ChevronRight,
  Heart,
  History,
  Megaphone,
  Package,
  Sparkles,
  Tag,
} from 'lucide-react-native';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { colors, spacing, storeType, TOUCH, type } from '../theme/tokens';
import { Text } from '../ui/text';
import {
  BANNER_SECONDS,
  bannerTargetOf,
  nextSlide,
  type SectionIcon,
  sectionIconOf,
  type SectionPlace,
  sectionSubtitleOf,
  sectionTitleOf,
} from './home-sections';
import { CustomerProductCard } from './product-card';
import { useAddOneStore } from './use-add';

// The parts «Нүүр», a section's full list and a category's page share (ADR-0092, in the E-mart
// structure of ADR-0095): a product card wired to the cart and ♡, a section's row, the banner
// carousel and the category tiles.

/** What a card does: open the product, add one of its default unit, ♡. */
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

const ICON_TONES: Record<SectionIcon['tone'], string> = {
  muted: colors.muted,
  promotion: colors.dealPromotion,
  discount: colors.dealDiscount,
  new: colors.primary,
};

function SectionGlyph({ icon }: { icon: SectionIcon }) {
  const color = ICON_TONES[icon.tone];
  const props = { size: 18, strokeWidth: 2.2, color };
  switch (icon.icon) {
    case 'history':
      return <History {...props} />;
    case 'megaphone':
      return <Megaphone {...props} />;
    case 'tag':
      return <Tag {...props} />;
    case 'sparkles':
      return <Sparkles {...props} strokeWidth={2} />;
    case 'heart':
      return <Heart {...props} fill={color} strokeWidth={2} />;
  }
}

/**
 * «АНГИЛЛЫН ЖАГСААЛТ ›», «УРАМШУУЛАЛ ›»: an upper-case heading with › that opens its list; on the
 * home a section's icon before it and its line under it.
 */
export function ListHeading({
  title,
  subtitle,
  icon,
  onPress,
  label,
  big = false,
}: {
  title: string;
  subtitle?: string | null;
  icon?: SectionIcon | null;
  onPress: () => void;
  label: string;
  /** «АНГИЛЛЫН ЖАГСААЛТ» is a size above a section's title. */
  big?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.heading, pressed && styles.pressed]}
    >
      {icon ? (
        <View style={styles.glyph}>
          <SectionGlyph icon={icon} />
        </View>
      ) : null}
      <View style={styles.grow}>
        <Text
          accessibilityRole="header"
          style={[big ? storeType.heading : storeType.sectionTitle, styles.upper]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={storeType.sectionSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={22} strokeWidth={1.8} color={colors.foreground} />
    </Pressable>
  );
}

/** A home row's cards (the E-mart screens: 164 wide, a 146 px picture). */
export const ROW_CARD_WIDTH = 164;
export const ROW_PICTURE = 146;

/** A row card's size, handed to the caller's card. */
export interface RowCardSize {
  width: number;
  pictureHeight: number;
}

const ROW_CARD: RowCardSize = { width: ROW_CARD_WIDTH, pictureHeight: ROW_PICTURE };

/** A section as a row shows it: «Bto300»'s and the rep app's (ADR-0100 #9) share the shape. */
export interface RowSection<P> extends Pick<
  StoreHomeSection,
  'key' | 'kind' | 'title' | 'subtitle' | 'lastDay'
> {
  products: readonly P[];
}

/**
 * A section of «Нүүр» or a category page: its heading (with the section's icon on the home) and up
 * to 10 cards in a row. The app draws its own card (`renderCard`): «Bto300»'s with ♡, the rep's
 * with its stock.
 */
export function SectionRow<P extends { id: number }>({
  section,
  place = 'home',
  renderCard,
  onMore,
}: {
  section: RowSection<P>;
  place?: SectionPlace;
  renderCard: (product: P, size: RowCardSize) => ReactElement;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const sectionText = useSectionText();
  const text = sectionText(section, place);
  return (
    <View style={styles.section}>
      <ListHeading
        title={text.title}
        subtitle={place === 'home' ? text.subtitle : null}
        icon={place === 'home' ? sectionIconOf(section.kind) : null}
        label={t('mobile.customer.home.seeAll', { title: text.title })}
        onPress={onMore}
      />
      <FlatList
        horizontal
        data={section.products}
        keyExtractor={(product) => String(product.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cards}
        initialNumToRender={3}
        renderItem={({ item }) => renderCard(item, ROW_CARD)}
      />
    </View>
  );
}

/**
 * The banners (ADR-0092 #5), the screen's width edge to edge: 2:1 pictures one at a time, swiped or
 * moved on every five seconds (the owner, 2026-10-20) — never while a finger is on them; the dots
 * below choose one. A tap opens its link (`targetOf`, by default a segment's list, a category's
 * page or a product: both apps have those routes); `server` serves the pictures.
 */
export function BannerCarousel({
  banners,
  server,
  targetOf = (banner) => bannerTargetOf(banner.link),
}: {
  banners: readonly StoreBanner[];
  server: string;
  targetOf?: (banner: StoreBanner) => string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
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
    <View>
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
        style={[styles.banners, { height: width / 2 }]}
      >
        {banners.map((banner) => {
          const target = targetOf(banner);
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
      {count > 1 ? (
        <View accessibilityLabel={t('mobile.customer.home.banners')} style={styles.dots}>
          {banners.map((banner, index) => (
            <Pressable
              key={banner.id}
              accessibilityRole="button"
              accessibilityLabel={t('mobile.customer.home.bannerDot', { n: index + 1 })}
              accessibilityState={{ selected: index === slide }}
              onPress={() => go(index)}
              hitSlop={6}
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
  server,
  width,
  height,
}: {
  category: Pick<StoreHomeCategory, 'imageUrl'>;
  server: string;
  width: number;
  height: number;
}) {
  return category.imageUrl ? (
    <Image
      source={{ uri: `${server}${category.imageUrl}` }}
      style={{ width, height }}
      contentFit="contain"
      cachePolicy="memory-disk"
      recyclingKey={category.imageUrl}
    />
  ) : (
    <Package size={height * 0.7} strokeWidth={1.3} color={colors.input} />
  );
}

/** «Ангиллын жагсаалт»'s tile (the E-mart screens): the picture without a frame, the name under it. */
export function CategoryTile({
  category,
  server,
  onPress,
}: {
  category: StoreHomeCategory;
  server: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.tilePicture}>
        <CategoryPicture category={category} server={server} width={56} height={48} />
      </View>
      <Text style={[storeType.tile, styles.center]} numberOfLines={2}>
        {category.name}
      </Text>
    </Pressable>
  );
}

/** A subcategory on a category's page: a larger picture and the name. */
export function SubcategoryTile({
  category,
  server,
  onPress,
}: {
  category: StoreHomeCategory;
  server: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sub, pressed && styles.pressed]}
    >
      <View style={styles.subPicture}>
        <CategoryPicture category={category} server={server} width={80} height={72} />
      </View>
      <Text style={[storeType.tile, styles.center]} numberOfLines={2}>
        {category.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 1 },
  center: { textAlign: 'center' },
  upper: { textTransform: 'uppercase' },
  pressed: { opacity: 0.6 },
  heading: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 14,
    paddingRight: spacing.sm,
    paddingBottom: 10,
  },
  glyph: { alignSelf: 'flex-start', width: 20, height: 21, justifyContent: 'center' },
  section: { paddingTop: 18 },
  cards: { gap: 10, paddingHorizontal: 14, paddingBottom: spacing.xs },
  banners: { backgroundColor: colors.imageFill },
  bannerImage: { width: '100%', height: '100%' },
  bannerFallback: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: colors.primaryPressed,
  },
  bannerTitle: { ...type.title2, color: colors.primaryForeground },
  dots: { flexDirection: 'row', justifyContent: 'center', paddingTop: spacing.xs },
  dotButton: { width: 22, height: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.input },
  dotOn: { backgroundColor: colors.label2 },
  tile: { flex: 1, alignItems: 'center', gap: 6 },
  tilePicture: { width: 64, height: 50, alignItems: 'center', justifyContent: 'center' },
  sub: { width: 88, alignItems: 'center', gap: 6 },
  subPicture: { width: 88, height: 76, alignItems: 'center', justifyContent: 'center' },
});
