import { MapPin, Phone, ReceiptText, ShoppingCart, Store } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { useCustomer } from '../api/rep';
import { colors, radii, spacing, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';
import { lastOrderOf, type MapStore, startAddressOf } from './stores';

/** How tall the store card is drawn; the map keeps its pin in view above it. */
export const STORE_SHEET_HEIGHT = 470;

/**
 * A tapped store (the owner, 2026-10-18): name, code, address and phone, when the rep last
 * ordered there, and three ways on: start an order for it (at this point's address), open the
 * last order, call it.
 */
export function StoreSheet({
  store: selected,
  today,
  freshDays,
  top,
  sendPending,
  onClose,
  onStart,
  onLastOrder,
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
  onLastOrder: (orderId: number) => void;
  onCall: (phone: string) => void;
}) {
  const { t } = useTranslation();
  // The last store stays drawn while the sheet slides away, so it does not empty on the way down.
  const [shown, setShown] = useState(selected);
  if (selected !== null && selected !== shown) setShown(selected);
  const store = selected ?? shown;
  const customer = useCustomer(store?.customerId ?? null);
  const last = store && today ? lastOrderOf(store, today) : null;
  const stale = store?.stale ?? true;
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
            {store.lastOrderId !== null || store.phone ? (
              <View style={styles.pair}>
                {store.lastOrderId !== null ? (
                  <PillButton
                    title={t('mobile.map.openLastOrder')}
                    variant="soft"
                    height={46}
                    style={styles.half}
                    icon={<ReceiptText size={17} strokeWidth={2.2} color={colors.link} />}
                    onPress={() => {
                      if (store.lastOrderId !== null) onLastOrder(store.lastOrderId);
                    }}
                  />
                ) : null}
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
            ) : null}
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
                { backgroundColor: stale ? colors.destructiveSoft : colors.successSoft },
              ]}
            >
              <Store
                size={24}
                strokeWidth={2}
                color={stale ? colors.destructive : colors.success}
              />
            </View>
            <View style={styles.grow}>
              <Text style={type.title3} numberOfLines={2}>
                {store.name}
              </Text>
              <Text style={type.secondary} numberOfLines={1}>
                {t('mobile.map.code', { code: store.code })}
              </Text>
            </View>
          </View>

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

          {store.address || store.phone ? (
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
  group: { marginTop: spacing.md },
  note: { marginTop: spacing.md, marginHorizontal: spacing.xs },
  actions: { gap: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, paddingHorizontal: spacing.md },
});
