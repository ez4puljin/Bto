import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { Check, Truck, Undo2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLoadingWork, useLoadOrders, useUndoLoad } from '../../../src/api/loading';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { shortDate, ubTime } from '../../../src/dates/dates';
import { formatMnt } from '../../../src/format/format';
import {
  keptTicks,
  type LoadingOrder,
  type LoadingStore,
  loadingSections,
  ordersToLoad,
  storeTotal,
} from '../../../src/loading/stores';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/**
 * «Ачилт» (ADR-0179): the driver's picked orders by store. The driver ticks the stores whose goods
 * went onto the truck and presses «Ачсан»: every waiting order of those stores is loaded by them
 * now (the server keeps who and when). Below, «Өнөөдөр ачсан» lists their own loadings of today
 * with the time; a wrong one is taken back from there. Pull to refresh; re-read every 30 s.
 */
export default function LoadingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const work = useLoadingWork();
  const loadOrders = useLoadOrders();
  const undoLoad = useUndoLoad();
  const sections = useMemo(() => loadingSections(work.data ?? []), [work.data]);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState<LoadingOrder | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  // A store loaded by another driver meanwhile leaves the ticks.
  useEffect(() => {
    setTicked((current) => {
      const kept = keptTicks(sections, current);
      return kept.size === current.size ? current : kept;
    });
  }, [sections]);

  const chosen = ordersToLoad(sections, ticked);
  const toggle = (customerId: number) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });

  const load = async () => {
    setConfirming(false);
    setProblem(null);
    try {
      await loadOrders.mutateAsync({ key, orderIds: chosen });
      toast.show({ message: t('mobile.loading.loaded', { n: ticked.size }) });
      setTicked(new Set());
    } catch (error) {
      setProblem(problemFrom(error));
      void work.refetch();
    } finally {
      // The request reached the server (or may have): the next attempt is a new one.
      setKey(Crypto.randomUUID());
    }
  };

  const undo = async (order: LoadingOrder) => {
    setUndoing(null);
    setProblem(null);
    try {
      await undoLoad.mutateAsync(order.orderId);
      toast.show({ message: t('mobile.loading.undone', { number: order.orderNumber ?? '' }) });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const storeRow = (store: LoadingStore, index: number) => {
    const on = ticked.has(store.customerId);
    return (
      <View key={store.customerId}>
        {index > 0 ? <Separator /> : null}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          onPress={() => toggle(store.customerId)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={[styles.box, on && styles.boxOn]}>
            {on ? <Check size={16} strokeWidth={3} color={colors.primaryForeground} /> : null}
          </View>
          <View style={styles.grow}>
            <View style={styles.rowTop}>
              <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
                {store.customerName}
              </Text>
              <Text style={type.rowStrong}>{`${formatMnt(storeTotal(store))}₮`}</Text>
            </View>
            {store.addressText ? (
              <Text style={type.secondary} numberOfLines={2}>
                {store.addressText}
              </Text>
            ) : null}
            {store.orders.map((order) => (
              <Text key={order.orderId} style={type.secondary} numberOfLines={1}>
                {[
                  order.orderNumber ?? `#${order.orderId}`,
                  t('mobile.loading.items', { n: order.lineCount }),
                  t('mobile.loading.deliver', { date: shortDate(order.deliveryDate) }),
                  t(`mobile.loading.pay.${order.paymentMethod}`),
                  order.status === 'PACKED' ? t('mobile.loading.notSold') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ))}
          </View>
        </Pressable>
      </View>
    );
  };

  const loadedRow = (store: LoadingStore, index: number) => (
    <View key={store.customerId}>
      {index > 0 ? <Separator /> : null}
      <View style={styles.loadedStore}>
        <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
          {store.customerName}
        </Text>
        {store.orders.map((order) => (
          <View key={order.orderId} style={styles.loadedOrder}>
            <Text style={[type.secondary, styles.grow]} numberOfLines={1}>
              {t('mobile.loading.loadedAt', {
                number: order.orderNumber ?? `#${order.orderId}`,
                time: order.loading ? ubTime(order.loading.loadedAt) : '',
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.loading.undo')}
              hitSlop={8}
              onPress={() => setUndoing(order)}
              style={({ pressed }) => [styles.undo, pressed && styles.faded]}
            >
              <Undo2 size={16} strokeWidth={2.4} color={colors.destructive} />
              <Text style={styles.undoText}>{t('mobile.loading.undo')}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );

  const empty = sections.waiting.length === 0 && sections.loaded.length === 0;
  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.loading.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: spacing.xl * 3 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={work.isRefetching} onRefresh={() => void work.refetch()} />
        }
      >
        <ProblemText problem={problem} style={styles.problem} />
        {work.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : work.error ? (
          <ProblemText problem={problemFrom(work.error)} />
        ) : empty ? (
          <EmptyState
            icon={<Truck size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.loading.empty')}
            hint={t('mobile.loading.emptyHint')}
          />
        ) : (
          <>
            <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
              {t('mobile.loading.waiting', { n: sections.waiting.length })}
            </Text>
            {sections.waiting.length > 0 ? (
              <View style={styles.card}>{sections.waiting.map(storeRow)}</View>
            ) : (
              <Text style={[type.secondary, styles.none]}>{t('mobile.loading.noneWaiting')}</Text>
            )}
            {sections.loaded.length > 0 ? (
              <>
                <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
                  {t('mobile.loading.today', { n: sections.loaded.length })}
                </Text>
                <View style={styles.card}>{sections.loaded.map(loadedRow)}</View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={
            ticked.size > 0
              ? t('mobile.loading.load', { n: ticked.size })
              : t('mobile.loading.choose')
          }
          icon={<Truck size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          disabled={chosen.length === 0}
          loading={loadOrders.isPending}
          onPress={() => setConfirming(true)}
        />
      </View>
      <ActionSheet
        visible={confirming}
        title={t('mobile.loading.confirmTitle', { n: ticked.size })}
        message={t('mobile.loading.confirmMessage', { n: chosen.length })}
        actions={[{ label: t('mobile.loading.confirm'), onPress: () => void load() }]}
        cancelLabel={t('mobile.loading.cancel')}
        onCancel={() => setConfirming(false)}
      />
      <ActionSheet
        visible={undoing !== null}
        title={t('mobile.loading.undoTitle', { number: undoing?.orderNumber ?? '' })}
        message={t('mobile.loading.undoMessage')}
        actions={[
          {
            label: t('mobile.loading.undo'),
            destructive: true,
            onPress: () => {
              if (undoing) void undo(undoing);
            },
          },
        ]}
        cancelLabel={t('mobile.loading.cancel')}
        onCancel={() => setUndoing(null)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 14, flexGrow: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { backgroundColor: colors.accent },
  faded: { opacity: 0.6 },
  problem: { marginTop: spacing.md },
  loading: { marginTop: spacing.xl },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  none: { paddingHorizontal: 2 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  box: {
    width: 26,
    height: 26,
    marginTop: 1,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  loadedStore: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
  loadedOrder: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  undoText: { ...type.secondary, color: colors.destructive, fontFamily: fonts.semibold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.input,
  },
});
