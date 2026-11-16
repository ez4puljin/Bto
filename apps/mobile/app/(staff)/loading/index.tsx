import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { Check, Printer, Truck, Undo2 } from 'lucide-react-native';
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
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { FooterBar, Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/**
 * «Ачилт» (ADR-0179): the driver's picked orders by store. The driver ticks the stores whose goods
 * went onto the truck (or all of them with «Бүгдийг сонгох») and presses «Ачсан»: every waiting order of those stores is loaded by them
 * now (the server keeps who and when). Below, «Өнөөдөр ачсан» lists their own loadings of today
 * with the time; a wrong one is taken back from there. Pull to refresh; re-read every 30 s.
 */
export default function LoadingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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

  const allTicked = sections.waiting.length > 0 && ticked.size === sections.waiting.length;
  const tickAll = () =>
    setTicked(allTicked ? new Set() : new Set(sections.waiting.map((store) => store.customerId)));

  const storeRow = (store: LoadingStore) => {
    const on = ticked.has(store.customerId);
    return (
      <Pressable
        key={store.customerId}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        onPress={() => toggle(store.customerId)}
        style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
      >
        <View style={[styles.box, on && styles.boxOn]}>
          {on ? <Check size={16} strokeWidth={3} color={colors.primaryForeground} /> : null}
        </View>
        <View style={styles.grow}>
          <View style={styles.rowTop}>
            <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
              {store.customerName}
            </Text>
            <Text style={[type.rowStrong, tabular]}>{`${formatMnt(storeTotal(store))}₮`}</Text>
          </View>
          {store.addressText ? (
            <Text style={type.secondary} numberOfLines={2}>
              {store.addressText}
            </Text>
          ) : null}
          {store.orders.map((order) => (
            <View key={order.orderId} style={styles.order}>
              <Text style={[type.secondary, tabular, styles.orderText]} numberOfLines={1}>
                {[
                  order.orderNumber ?? `#${order.orderId}`,
                  t('mobile.loading.items', { n: order.lineCount }),
                  t('mobile.loading.deliver', { date: shortDate(order.deliveryDate) }),
                  t(`mobile.loading.pay.${order.paymentMethod}`),
                ].join(' · ')}
              </Text>
              {order.status === 'PACKED' ? (
                <Pill label={t('mobile.loading.notSold')} tone="warn" icon={Printer} />
              ) : null}
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  const loadedRow = (store: LoadingStore) => (
    <View key={store.customerId} style={styles.loadedStore}>
      <IconTile color={colors.successSoft}>
        <Truck size={20} strokeWidth={2} color={colors.success} />
      </IconTile>
      <View style={styles.grow}>
        <Text style={type.row} numberOfLines={1}>
          {store.customerName}
        </Text>
        {store.orders.map((order) => (
          <View key={order.orderId} style={styles.loadedOrder}>
            <Text style={[type.secondary, tabular, styles.rowTitle]} numberOfLines={1}>
              {t('mobile.loading.loadedAt', {
                number: order.orderNumber ?? `#${order.orderId}`,
                time: order.loading ? ubTime(order.loading.loadedAt) : '',
              })}
            </Text>
            <PillButton
              title={t('mobile.loading.undo')}
              accessibilityLabel={t('mobile.loading.undoTitle', {
                number: order.orderNumber ?? `#${order.orderId}`,
              })}
              variant="destructive"
              height={36}
              icon={<Undo2 size={16} strokeWidth={2.2} color={colors.destructive} />}
              style={styles.undo}
              onPress={() => setUndoing(order)}
            />
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
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={work.isRefetching} onRefresh={() => void work.refetch()} />
        }
      >
        <ProblemText problem={problem} />
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
            <View>
              <SectionHeader
                style={styles.sectionHeader}
                right={
                  sections.waiting.length > 1 ? (
                    <Pressable accessibilityRole="button" hitSlop={14} onPress={tickAll}>
                      <Text style={styles.sectionLink}>
                        {t(allTicked ? 'mobile.loading.selectNone' : 'mobile.loading.selectAll')}
                      </Text>
                    </Pressable>
                  ) : null
                }
              >
                {t('mobile.loading.waiting', { n: sections.waiting.length })}
              </SectionHeader>
              {sections.waiting.length > 0 ? (
                <Group inset={0}>{sections.waiting.map(storeRow)}</Group>
              ) : (
                <Text style={[type.secondary, styles.none]}>{t('mobile.loading.noneWaiting')}</Text>
              )}
            </View>
            {sections.loaded.length > 0 ? (
              <View>
                <SectionHeader style={styles.sectionHeader}>
                  {t('mobile.loading.today', { n: sections.loaded.length })}
                </SectionHeader>
                <Group inset={ICON_INSET}>{sections.loaded.map(loadedRow)}</Group>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <FooterBar>
        <PillButton
          title={
            ticked.size > 0
              ? t('mobile.loading.load', { n: ticked.size })
              : t('mobile.loading.choose')
          }
          icon={<Truck size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
          style={styles.fill}
          disabled={chosen.length === 0}
          loading={loadOrders.isPending}
          onPress={() => setConfirming(true)}
        />
      </FooterBar>
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
  fill: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  pressed: { backgroundColor: colors.accent },
  loading: { marginTop: spacing.xl },
  sectionHeader: { marginTop: spacing.xs },
  sectionLink: { ...type.chip, color: colors.link },
  none: { paddingHorizontal: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowOn: { backgroundColor: colors.secondary },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  order: { gap: spacing.xs },
  orderText: { color: colors.label2 },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  loadedStore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  loadedOrder: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  undo: { paddingHorizontal: 14 },
});
