import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Bell,
  ChevronRight,
  CircleAlert,
  Phone,
  ScanBarcode,
  ShoppingCart,
  Star,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  cachedStoreProduct,
  type StoreBalance,
  type StoreContact,
  type StoreOrderRow as StoreOrderRowData,
  type StoreProduct,
  useContacts,
  useFavourites,
  useRecentStoreOrders,
  useStoreBalance,
  useStoreMe,
  useStoreProductsOf,
  useStoreQuote,
} from '../../../src/api/customer';
import { useStoreNotificationSummary } from '../../../src/api/customer-notifications';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { linesOf } from '../../../src/cart/cart';
import { creditBarOf, debtOf, overdueOf } from '../../../src/customer/account';
import {
  cartTotalOf,
  contactInitialsOf,
  homeFavourites,
  inOrderOf,
  orderDayOf,
  phoneShown,
  shownContacts,
} from '../../../src/customer/home';
import { StoreOrderRow, useTakerText } from '../../../src/customer/order-row';
import { takerOf } from '../../../src/customer/orders';
import { monthDay } from '../../../src/dates/calendar';
import { formatMnt, initialsOf } from '../../../src/format/format';
import { dateLineOf } from '../../../src/home/home';
import { cardPictures } from '../../../src/images/pictures';
import { callNow } from '../../../src/phone/call';
import { useCustomer } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import {
  AVATAR_TINTS,
  colors,
  fonts,
  radii,
  spacing,
  tabular,
  TOUCH,
  type,
} from '../../../src/theme/tokens';
import { CardPictures } from '../../../src/ui/card-pictures';
import { CircleButton } from '../../../src/ui/controls';
import { Group } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page, SectionTitle } from '../../../src/ui/layout';
import { usePriceParts } from '../../../src/ui/product-card';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const TILE_GAP = 10;

/**
 * «Нүүр» of «Bto300» (the Main board; ADR-0079 #7, #13, #14): the scanner, the bell and the store's
 * initials (its profile); the day and the store; what it owes, anything overdue and the credit
 * left, opening «Тооцоо»; the cart while it is not sent; the last two orders; three ★ products; and
 * the company's contact people, a tap on one calling at once.
 */
export default function CustomerHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const { me } = useCustomer();
  const storeMe = useStoreMe();
  const store = storeMe.data ?? me.store;
  const today = store.today;
  const summary = useStoreNotificationSummary();
  const unread = summary.data?.unread ?? 0;
  const balance = useStoreBalance();
  const recent = useRecentStoreOrders(2);
  const favourites = useFavourites();
  const contacts = useContacts();
  const [refreshing, setRefreshing] = useState(false);

  const date = dateLineOf(today);
  const dateLine = t('mobile.home.dateLong', {
    weekday: t(`mobile.weekdaysLong.${date.weekday}`),
    month: date.month,
    day: date.day,
  });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        storeMe.refetch(),
        summary.refetch(),
        balance.refetch(),
        recent.refetch(),
        favourites.refetch(),
        contacts.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.bar}>
          <CircleButton
            icon={<ScanBarcode size={22} strokeWidth={1.9} color={colors.foreground} />}
            label={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
          />
          <CircleButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.foreground} />}
            label={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            badge={unread}
            badgeRing={colors.canvas}
            onPress={() => router.push('/notifications')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.tabs.profile')}
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(store.name)}</Text>
          </Pressable>
        </View>
        <Text style={[type.secondary, styles.date]} numberOfLines={1}>
          {dateLine}
        </Text>
        <LargeTitle style={styles.title}>{store.name}</LargeTitle>

        {balance.data ? (
          <DebtCard account={balance.data} onPress={() => router.navigate('/account')} />
        ) : balance.error ? (
          <ProblemText problem={problemFrom(balance.error)} style={styles.debtProblem} />
        ) : (
          <View style={[styles.debt, styles.debtLoading]} />
        )}

        <CartBanner />

        <SectionTitle
          action={t('mobile.home.seeAll')}
          onAction={() => router.navigate('/orders')}
          style={styles.section}
        >
          {t('mobile.customer.home.recent')}
        </SectionTitle>
        <RecentOrders
          orders={recent.data}
          today={today}
          problem={recent.error ? problemFrom(recent.error) : null}
          onOpen={(order) => router.push(`/order/${order.id}`)}
        />

        <SectionTitle
          action={t('mobile.home.seeAll')}
          onAction={() => router.navigate({ pathname: '/shop', params: { favourites: '1' } })}
          style={styles.section}
        >
          {t('mobile.customer.home.favourites')}
        </SectionTitle>
        <Favourites
          ids={favourites.data?.productIds}
          loading={favourites.isLoading}
          problem={favourites.error ? problemFrom(favourites.error) : null}
        />

        <Contacts contacts={contacts.data} />
      </ScrollView>
    </Page>
  );
}

/** «Таны өр 1,284,600₮ · Тооцоо ›», the overdue amount and the credit left; opens «Тооцоо». */
function DebtCard({ account, onPress }: { account: StoreBalance; onPress: () => void }) {
  const { t } = useTranslation();
  const debt = debtOf(account.balance);
  const overdue = overdueOf(account);
  const credit = creditBarOf(account);
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.debt, pressed && styles.pressed]}
    >
      <View style={styles.debtTop}>
        <View style={styles.grow}>
          <Text style={[type.body, styles.muted]}>
            {debt.kind === 'advance'
              ? t('mobile.customer.home.advance')
              : t('mobile.customer.home.debt')}
          </Text>
          <Text
            style={[styles.debtAmount, debt.kind === 'advance' && styles.advance]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {debt.kind === 'clear' ? t('mobile.customer.home.clear') : money(debt.amount)}
          </Text>
        </View>
        <View style={styles.accountLink}>
          <Text style={[type.row, styles.link]}>{t('mobile.customer.tabs.account')}</Text>
          <ChevronRight size={16} strokeWidth={2.4} color={colors.primary} />
        </View>
      </View>
      {overdue ? (
        <View style={styles.overdue}>
          <CircleAlert size={18} strokeWidth={2.2} color={colors.cancelled} />
          <Text style={[type.body, styles.overdueText]}>
            {t('mobile.customer.home.overdue')}{' '}
            <Text style={[type.bodyStrong, styles.overdueAmount]}>{money(overdue.amount)}</Text>
            {overdue.since
              ? ` · ${t('mobile.customer.home.overdueSince', { date: monthDay(overdue.since) })}`
              : null}
          </Text>
        </View>
      ) : null}
      {credit ? (
        <View style={styles.credit}>
          <View style={styles.creditLine}>
            <Text style={[type.secondary, styles.grow]} numberOfLines={1}>
              {t('mobile.customer.home.creditLeft')}
            </Text>
            <Text style={styles.creditValue} numberOfLines={1}>
              {t('mobile.customer.home.creditOf', {
                available: money(credit.available),
                limit: money(credit.limit),
              })}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(credit.free * 100)}%` }]} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

/** «Сагсанд 3 бараа · 419,600₮ · илгээгээгүй … Үргэлжлүүлэх» while the cart holds lines. */
function CartBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { cart, pending } = useShop();
  const lines = useMemo(() => linesOf(cart), [cart]);
  const quote = useStoreQuote(lines);
  if (cart.lines.length === 0) return null;
  const total = cartTotalOf(quote.data?.quote);
  const line =
    pending !== null
      ? t('mobile.home.pending')
      : [
          total ? t('pricing.money', { amount: formatMnt(total) }) : null,
          t('mobile.customer.home.cartUnsent'),
        ]
          .filter((part) => part !== null)
          .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.navigate('/cart')}
      style={({ pressed }) => [styles.cart, pressed && styles.cartPressed]}
    >
      <View style={styles.cartIcon}>
        <ShoppingCart size={18} strokeWidth={2.2} color={colors.primaryForeground} />
      </View>
      <View style={styles.grow}>
        <Text style={type.rowStrong} numberOfLines={1}>
          {t('mobile.home.cartTitle', { n: cart.lines.length })}
        </Text>
        <Text style={[type.secondary, styles.label2]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Text style={[type.bodyStrong, styles.link]}>{t('mobile.home.continue')}</Text>
    </Pressable>
  );
}

/** The last two orders of any channel: «Өнөөдөр 09:42 · Апп · 3 бараа». */
function RecentOrders({
  orders,
  today,
  problem,
  onOpen,
}: {
  orders: StoreOrderRowData[] | undefined;
  today: string;
  problem: AppProblem | null;
  onOpen: (order: StoreOrderRowData) => void;
}) {
  const { t } = useTranslation();
  const taker = useTakerText();
  if (!orders) {
    return problem ? (
      <ProblemText problem={problem} style={styles.flush} />
    ) : (
      <View style={[styles.empty, styles.ordersLoading]} />
    );
  }
  if (orders.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[type.body, styles.muted, styles.center]}>
          {t('mobile.customer.home.recentEmpty')}
        </Text>
      </View>
    );
  }
  const metaOf = (order: StoreOrderRowData) => {
    const day = orderDayOf(order.createdDate, today);
    const dayText =
      day.kind === 'today'
        ? t('mobile.days.today')
        : day.kind === 'yesterday'
          ? t('mobile.days.yesterday')
          : day.date;
    return [
      `${dayText} ${order.createdTime}`,
      taker(takerOf(order)),
      t('mobile.customer.home.lines', { n: order.lineCount }),
    ].join(' · ');
  };
  return (
    <Group>
      {orders.map((order) => (
        <StoreOrderRow
          key={order.id}
          order={order}
          meta={metaOf(order)}
          onPress={() => onOpen(order)}
        />
      ))}
    </Group>
  );
}

/** Up to three ★ products, the newest star first; each opens its page. */
function Favourites({
  ids,
  loading,
  problem,
}: {
  ids: number[] | undefined;
  loading: boolean;
  problem: AppProblem | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { server } = useCustomer();
  const priceParts = usePriceParts();
  const shown = useMemo(() => homeFavourites(ids ?? []), [ids]);
  const seed = useMemo(
    () =>
      shown.flatMap((id) => {
        const product = cachedStoreProduct(queryClient, id);
        return product ? [product] : [];
      }),
    [shown, queryClient],
  );
  const products = useStoreProductsOf(shown, seed);
  const tiles = inOrderOf(shown, products.data ?? []);
  const tileWidth = (width - spacing.lg * 2 - TILE_GAP * 2) / 3;

  if (loading || (shown.length > 0 && products.isLoading && tiles.length === 0)) {
    return (
      <View style={styles.tiles}>
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={[styles.tilePicture, styles.skeleton, { width: tileWidth, height: tileWidth }]}
          />
        ))}
      </View>
    );
  }
  const failed = problem ?? (products.error ? problemFrom(products.error) : null);
  if (tiles.length === 0 && failed) return <ProblemText problem={failed} style={styles.flush} />;
  if (tiles.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[type.body, styles.muted, styles.center]}>
          {t('mobile.customer.home.favouritesEmpty')}
        </Text>
      </View>
    );
  }
  const open = (product: StoreProduct) => router.push(`/product/${product.id}`);
  return (
    <View style={styles.tiles}>
      {tiles.map((product) => {
        const price = priceParts(product);
        return (
          <Pressable
            key={product.id}
            accessibilityRole="button"
            accessibilityLabel={product.name}
            onPress={() => open(product)}
            style={[styles.tile, { width: tileWidth }]}
          >
            <View style={[styles.tilePicture, { width: tileWidth, height: tileWidth }]}>
              <CardPictures
                urls={cardPictures(product).slice(0, 1)}
                server={server}
                dim={false}
                onPress={() => open(product)}
              />
              <View style={styles.star} pointerEvents="none">
                <Star
                  size={14}
                  strokeWidth={2}
                  color={colors.tint.amber}
                  fill={colors.tint.amber}
                />
              </View>
            </View>
            <Text style={styles.tileName} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={type.secondary} numberOfLines={1}>
              {price ? `${price.price} ${price.per}` : t('mobile.shop.noPrice')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * «Холбоо барих» (ADR-0079 #14): the company's contact people the admins show, in their order; a
 * tap anywhere on a row calls at once (the permission is asked on the first tap, the dialer opens
 * after a «no»).
 */
function Contacts({ contacts }: { contacts: StoreContact[] | undefined }) {
  const { t } = useTranslation();
  const toast = useToast();
  const people = shownContacts(contacts ?? []);
  if (people.length === 0) return null;

  const call = async (contact: StoreContact) => {
    const phone = phoneShown(contact.phone);
    const outcome = await callNow(contact.phone);
    if (outcome !== 'none') {
      toast.show({ message: t('mobile.customer.contacts.calling', { role: contact.role, phone }) });
    }
  };

  return (
    <>
      <View style={styles.contactsTitle}>
        <Text accessibilityRole="header" style={[type.sectionTitle, styles.grow]} numberOfLines={1}>
          {t('mobile.customer.contacts.title')}
        </Text>
        <Text style={type.secondary}>{t('mobile.customer.contacts.hint')}</Text>
      </View>
      <Group>
        {people.map((contact, index) => {
          const phone = phoneShown(contact.phone);
          return (
            <Pressable
              key={contact.id}
              accessibilityRole="button"
              accessibilityLabel={t('mobile.customer.contacts.callLabel', {
                role: contact.role,
                phone,
              })}
              onPress={() => void call(contact)}
              style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.contactAvatar,
                  { backgroundColor: AVATAR_TINTS[index % AVATAR_TINTS.length] },
                ]}
              >
                <Text style={styles.contactInitials}>{contactInitialsOf(contact.role)}</Text>
              </View>
              <View style={styles.grow}>
                <Text style={type.rowStrong} numberOfLines={2}>
                  {contact.role}
                </Text>
                <Text style={type.secondary} numberOfLines={1}>
                  {contact.name}
                </Text>
                <Text style={[type.row, styles.phone]} numberOfLines={1}>
                  {phone}
                </Text>
              </View>
              <View style={styles.callButton}>
                <Phone size={20} strokeWidth={2.2} color={colors.primaryForeground} />
              </View>
            </Pressable>
          );
        })}
      </Group>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  muted: { color: colors.muted },
  label2: { color: colors.label2 },
  link: { color: colors.primary },
  pressed: { backgroundColor: colors.accent },
  flush: { marginTop: 0 },
  bar: {
    height: TOUCH,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  avatar: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.tint.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPressed: { opacity: 0.8 },
  avatarText: { ...type.rowStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
  date: { marginTop: 6, marginHorizontal: spacing.xs },
  title: { marginHorizontal: spacing.xs },
  debt: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
  },
  debtLoading: { height: 120 },
  debtProblem: { marginTop: spacing.lg },
  debtTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  debtAmount: { ...type.largeTitle, ...tabular, marginTop: 2 },
  advance: { color: colors.success },
  accountLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 24 },
  overdue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.destructiveSoft,
  },
  overdueText: { flex: 1, color: colors.cancelled },
  overdueAmount: { ...tabular, fontFamily: fonts.bold, color: colors.cancelled },
  credit: { gap: 6 },
  creditLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  creditValue: {
    ...type.secondary,
    ...tabular,
    fontFamily: fonts.semibold,
    color: colors.foreground,
  },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  cart: {
    marginTop: spacing.md,
    minHeight: 60,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.secondary,
  },
  cartPressed: { backgroundColor: colors.fill },
  cartIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { padding: 20, borderRadius: radii.card, backgroundColor: colors.card },
  ordersLoading: { height: 72 },
  tiles: { flexDirection: 'row', gap: TILE_GAP },
  tile: { gap: 6 },
  tilePicture: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { backgroundColor: colors.fill },
  star: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.glassFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { ...type.chip, fontFamily: fonts.semibold },
  contactsTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInitials: { ...type.bodyStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
  phone: { ...tabular, color: colors.link },
  callButton: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.tint.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
