import {
  ChevronRight,
  History,
  Lock,
  MapPin,
  Phone,
  ShoppingCart,
  Store,
  UserRound,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { useCustomer, useStoreOrders } from '../api/rep';
import { StoreOrderRow } from '../orders/store-order-row';
import { colors, radii, spacing, storeType, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';
import { lastOrderOf, type MapStore, startAddressOf } from './stores';

/** How tall the store card is drawn; the map keeps its pin in view above it. */
export const STORE_SHEET_HEIGHT = 510;

/** How many of the store's orders the card shows; the heading's › opens the rest. */
const HISTORY_ROWS = 3;

/**
 * A tapped store (the owner, 2026-10-18): name, code, whether the accountant closed its orders
 * (a dark banner with the reason), address, its phone and its contact
 * persons' (a tap calls at once), when the rep last ordered there, and its latest orders, anyone's,
 * with who took them and when (only the rep's own open; drawn above the address and phones so they
 * show without scrolling). Three ways on: start an order for it (at
 * this point's address), its whole order history, call it. «Bto300»'s type (ADR-0100): the name
 * at the heading's size, the history under an upper-case heading with ›.
 */
export function StoreSheet({
  store: selected,
  today,
  freshDays,
  top,
  sendPending,
  onClose,
  onStart,
  onHistory,
  onOpenOrder,
  onCall,
}: {
  store: MapStore | null;
  today: string | null;
  freshDays: number;
  /** Where the sheet starts below the status bar (the map stays visible above it). */
  top: number;
  /** A send waits for its answer: a new order cannot start (the cart is locked). */
  sendPending: boolean;
  onClose: () => void;
  onStart: (customer: { id: number; code: string; name: string }, addressId: number | null) => void;
  /** The store's whole order history. */
  onHistory: (store: MapStore) => void;
  /** One of the rep's own orders of the history. */
  onOpenOrder: (orderId: number) => void;
  onCall: (phone: string) => void;
}) {
  const { t } = useTranslation();
  // The last store stays drawn while the sheet slides away, so it does not empty on the way down.
  const [shown, setShown] = useState(selected);
  if (selected !== null && selected !== shown) setShown(selected);
  const store = selected ?? shown;
  const customer = useCustomer(store?.customerId ?? null);
  const history = useStoreOrders(store?.customerId ?? null);
  const latest = history.data?.pages[0]?.data ?? [];
  const more = latest.length > HISTORY_ROWS || history.hasNextPage;
  // The contact persons with a phone, after the store's own (the same number once).
  const contacts = (customer.data?.contacts ?? []).filter(
    (contact): contact is { name: string | null; phone: string } =>
      contact.phone !== null && contact.phone !== '' && contact.phone !== store?.phone,
  );
  const last = store && today ? lastOrderOf(store, today) : null;
  const stale = store?.stale ?? true;
  const blocked = store?.creditHold ?? false;
  const ago = last
    ? last.days === 0
      ? t('mobile.map.today')
      : last.days === 1
        ? t('mobile.map.yesterday')
        : t('mobile.map.daysAgo', { n: last.days })
    : null;

  const start = () => {
    const detail = customer.data;
    if (!detail || !store) return;
    // The order goes to the address whose point was tapped (the default one if it is gone).
    onStart(
      { id: detail.id, code: detail.code, name: detail.name },
      startAddressOf(detail.addresses, store.addressId),
    );
  };

  return (
    <Sheet
      visible={selected !== null}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={top}
      header={
        <SheetHeader
          title={t('mobile.map.store')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
      footer={
        store ? (
          <View style={styles.actions}>
            <PillButton
              title={t('mobile.map.startOrder')}
              icon={<ShoppingCart size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
              loading={customer.isLoading}
              disabled={sendPending || !customer.data}
              onPress={start}
            />
            <View style={styles.pair}>
              {/* «Түүх» beside «Залгах»: the long title is cut in half a 360 dp row at 1.15×. */}
              <PillButton
                title={t(store.phone ? 'mobile.storeOrders.short' : 'mobile.storeOrders.title')}
                accessibilityLabel={t('mobile.storeOrders.title')}
                variant="soft"
                height={46}
                style={styles.half}
                icon={<History size={17} strokeWidth={2.2} color={colors.link} />}
                onPress={() => onHistory(store)}
              />
              {store.phone ? (
                <PillButton
                  title={t('mobile.map.call')}
                  variant="soft"
                  height={46}
                  style={styles.half}
                  icon={<Phone size={17} strokeWidth={2.2} color={colors.link} />}
                  onPress={() => {
                    if (store.phone) onCall(store.phone);
                  }}
                />
              ) : null}
            </View>
          </View>
        ) : null
      }
    >
      {store ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.hero}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: blocked
                    ? colors.blocked
                    : stale
                      ? colors.destructiveSoft
                      : colors.successSoft,
                },
              ]}
            >
              <Store
                size={24}
                strokeWidth={2}
                color={
                  blocked ? colors.primaryForeground : stale ? colors.destructive : colors.success
                }
              />
            </View>
            <View style={styles.grow}>
              <Text style={storeType.heading} numberOfLines={2}>
                {store.name}
              </Text>
              <Text style={storeType.cardPack} numberOfLines={1}>
                {t('mobile.map.code', { code: store.code })}
              </Text>
            </View>
          </View>

          {/* The accountant closed the store's orders (credit hold): said before anything else. A
              draft can still be started; the office's credit check refuses its confirmation. */}
          {blocked ? (
            <View style={styles.blocked} accessibilityRole="alert">
              <Lock size={20} strokeWidth={2.2} color={colors.primaryForeground} />
              <View style={styles.grow}>
                <Text style={[type.bodyStrong, styles.onBlocked]}>{t('mobile.map.blocked')}</Text>
                <Text style={[type.secondary, styles.onBlockedMuted]}>
                  {store.creditHoldReason
                    ? t('mobile.map.blockedReason', { reason: store.creditHoldReason })
                    : t('mobile.map.blockedNote')}
                </Text>
              </View>
            </View>
          ) : null}

          <View
            style={[
              styles.status,
              { backgroundColor: stale ? colors.destructiveSoft : colors.successSoft },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: stale ? colors.tint.red : colors.tint.green }]}
            />
            <View style={styles.grow}>
              <Text
                style={[type.bodyStrong, { color: stale ? colors.destructive : colors.success }]}
              >
                {last && ago
                  ? t('mobile.map.lastOrder', { date: last.date, ago })
                  : t('mobile.map.noOrder')}
              </Text>
              <Text
                style={[type.secondary, { color: stale ? colors.destructive : colors.success }]}
              >
                {t(stale ? 'mobile.map.staleNote' : 'mobile.map.freshNote', { days: freshDays })}
              </Text>
            </View>
          </View>

          {/* Right below the status: on a 360x740 phone the footer leaves the body ~265 dp. */}
          <Pressable
            accessibilityRole={more ? 'link' : undefined}
            accessibilityLabel={
              more
                ? `${t('mobile.storeOrders.title')}, ${t('mobile.home.seeAll')}`
                : t('mobile.storeOrders.title')
            }
            disabled={!more}
            onPress={() => onHistory(store)}
            style={({ pressed }) => [styles.historyTitle, pressed && styles.pressed]}
          >
            <Text
              accessibilityRole="header"
              style={[storeType.sectionTitle, styles.upper, styles.grow]}
              numberOfLines={1}
            >
              {t('mobile.storeOrders.title')}
            </Text>
            {more ? <ChevronRight size={22} strokeWidth={1.8} color={colors.foreground} /> : null}
          </Pressable>
          {latest.length > 0 ? (
            <Group>
              {latest.slice(0, HISTORY_ROWS).map((order) => (
                <StoreOrderRow key={order.id} order={order} onOpen={onOpenOrder} />
              ))}
            </Group>
          ) : history.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : history.error ? (
            <ProblemText problem={problemFrom(history.error)} style={styles.flush} />
          ) : history.data ? (
            <Text style={[type.secondary, styles.note]}>{t('mobile.storeOrders.empty')}</Text>
          ) : null}

          {store.address || store.phone || contacts.length > 0 ? (
            <Group inset={ICON_INSET} style={styles.group}>
              {store.address ? (
                <Row
                  key="address"
                  icon={
                    <IconTile color={colors.tint.orange}>
                      <MapPin size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    </IconTile>
                  }
                  title={store.address}
                  subtitle={t('mobile.map.address')}
                />
              ) : null}
              {store.phone ? (
                <Row
                  key="phone"
                  icon={
                    <IconTile color={colors.tint.green}>
                      <Phone size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    </IconTile>
                  }
                  title={store.phone}
                  subtitle={t('mobile.map.phone')}
                  onPress={() => {
                    if (store.phone) onCall(store.phone);
                  }}
                  chevron={false}
                  accent
                />
              ) : null}
              {contacts.map((contact, index) => (
                <Row
                  key={'contact-' + String(index)}
                  icon={
                    <IconTile color={colors.tint.blue}>
                      <UserRound size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    </IconTile>
                  }
                  title={contact.phone}
                  subtitle={contact.name ?? t('mobile.map.contact')}
                  onPress={() => onCall(contact.phone)}
                  chevron={false}
                  accent
                />
              ))}
            </Group>
          ) : null}

          {sendPending ? (
            <Text style={[type.secondary, styles.note]}>{t('mobile.map.pending')}</Text>
          ) : null}
          {customer.error ? <ProblemText problem={problemFrom(customer.error)} /> : null}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  grow: { flex: 1, gap: 2 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.xs },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.field,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  blocked: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.field,
    backgroundColor: colors.blocked,
  },
  onBlocked: { color: colors.primaryForeground },
  onBlockedMuted: { color: colors.onPrimaryMuted },
  group: { marginTop: spacing.lg },
  historyTitle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.field,
  },
  pressed: { backgroundColor: colors.accent },
  upper: { textTransform: 'uppercase' },
  loading: { marginTop: spacing.sm },
  flush: { marginTop: 0 },
  note: { marginTop: spacing.md, marginHorizontal: spacing.xs },
  actions: { gap: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, paddingHorizontal: spacing.md },
});
