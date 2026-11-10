import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { Check, MapPinned, Plus } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
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
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useCustomers } from '../../../src/api/rep';
import {
  type CollectionMethod,
  type RepCollection,
  type RepTodayStop,
  useMarkVisit,
  useMyCollections,
  useReportCollection,
  useVisitsToday,
  type VisitResult,
} from '../../../src/api/visits';
import { shortDate, ubTime } from '../../../src/dates/dates';
import { formatMnt } from '../../../src/format/format';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, SearchField, Segmented } from '../../../src/ui/controls';
import { InputRow, Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';
import { amountOf, orderedStops, progressOf } from '../../../src/visits/stops';

const RESULTS: readonly VisitResult[] = ['ORDERED', 'NO_ORDER', 'CLOSED', 'PAYMENT'];
const METHODS: readonly CollectionMethod[] = ['CASH', 'TRANSFER'];
type Tab = 'today' | 'money';

interface Store {
  customerId: number;
  name: string;
  address: string | null;
}

const STATUS_COLOR: Record<RepCollection['status'], string> = {
  PENDING: colors.warningText,
  RECORDED: colors.success,
  REJECTED: colors.destructiveText,
};

/**
 * «Айлчлал» (ADR-0183): the rep's stores of today from the weekly round the office keeps, each
 * marked with what the visit came to; a store outside the round is added from the search. Money a
 * store hands over is reported here and waits for the accountant — «Төлбөр» lists the rep's own
 * reports with what became of them. Pull to refresh.
 */
export default function VisitsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const today = useVisitsToday();
  const collections = useMyCollections();
  const markVisit = useMarkVisit();
  const report = useReportCollection();
  const [tab, setTab] = useState<Tab>('today');
  const [store, setStore] = useState<Store | null>(null);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<VisitResult>('ORDERED');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CollectionMethod>('CASH');
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [moneyKey, setMoneyKey] = useState(() => Crypto.randomUUID());
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const stops = useMemo(() => orderedStops(today.data?.stops ?? []), [today.data]);
  const progress = progressOf(today.data?.stops ?? []);
  const money = result === 'PAYMENT' ? amountOf(amount) : null;
  const ready = store !== null && (result !== 'PAYMENT' || money !== null);

  const open = (next: Store) => {
    setPicking(false);
    setProblem(null);
    setResult('ORDERED');
    setNote('');
    setAmount('');
    setMethod('CASH');
    setKey(Crypto.randomUUID());
    setMoneyKey(Crypto.randomUUID());
    setStore(next);
  };

  const save = async () => {
    if (!store || !ready) return;
    setProblem(null);
    const text = note.trim() === '' ? null : note.trim();
    try {
      if (result === 'PAYMENT' && money !== null) {
        await report.mutateAsync({
          key: moneyKey,
          customerId: store.customerId,
          amount: money,
          method,
          note: text,
        });
      }
      await markVisit.mutateAsync({ key, customerId: store.customerId, result, note: text });
      toast.show({
        message: result === 'PAYMENT' ? t('mobile.visits.reported') : t('mobile.visits.saved'),
      });
      setStore(null);
    } catch (error) {
      // The same keys go again: a part that reached the server is not written twice.
      setProblem(problemFrom(error));
    }
  };

  const stopRow = (stop: RepTodayStop, index: number) => (
    <View key={stop.customerId}>
      {index > 0 ? <Separator /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          open({ customerId: stop.customerId, name: stop.name, address: stop.address })
        }
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.dot, stop.visit ? styles.dotDone : null]}>
          {stop.visit ? <Check size={14} strokeWidth={3} color={colors.primaryForeground} /> : null}
        </View>
        <View style={styles.grow}>
          <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
            {stop.name}
          </Text>
          {stop.address ? (
            <Text style={type.secondary} numberOfLines={1}>
              {stop.address}
            </Text>
          ) : null}
          <Text
            style={[type.secondary, stop.creditHold && !stop.visit ? styles.hold : null]}
            numberOfLines={1}
          >
            {stop.visit
              ? [
                  t(`mobile.visits.results.${stop.visit.result}`),
                  ubTime(stop.visit.visitedAt),
                  stop.planned ? null : t('mobile.visits.extra'),
                  stop.visit.note,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : stop.creditHold
                ? t('mobile.visits.hold')
                : t('mobile.visits.notVisited')}
          </Text>
        </View>
      </Pressable>
    </View>
  );

  const moneyRow = (row: RepCollection, index: number) => (
    <View key={row.id}>
      {index > 0 ? <Separator /> : null}
      <View style={styles.moneyRow}>
        <View style={styles.rowTop}>
          <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
            {row.customerName}
          </Text>
          <Text style={type.rowStrong}>{`${formatMnt(row.amount)}₮`}</Text>
        </View>
        <Text style={type.secondary} numberOfLines={1}>
          {[shortDate(row.collectedOn), t(`mobile.visits.methods.${row.method}`), row.note]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={[type.secondary, styles.status, { color: STATUS_COLOR[row.status] }]}>
          {row.status === 'REJECTED' && row.decisionNote
            ? t('mobile.visits.rejectedWhy', { reason: row.decisionNote })
            : row.status === 'RECORDED' && row.paymentNumber
              ? t('mobile.visits.recordedAs', { number: row.paymentNumber })
              : t(`mobile.visits.statuses.${row.status}`)}
        </Text>
      </View>
    </View>
  );

  const query = tab === 'today' ? today : collections;
  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.visits.title')} onBack={() => router.back()} />
      <View style={styles.tabs}>
        <Segmented
          options={[
            { value: 'today', label: t('mobile.visits.tabs.today') },
            { value: 'money', label: t('mobile.visits.tabs.money') },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: spacing.xl * 3 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        {query.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : query.error ? (
          <ProblemText problem={problemFrom(query.error)} style={styles.problem} />
        ) : tab === 'today' ? (
          <>
            <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
              {t('mobile.visits.progress', {
                day: t(
                  `mobile.weekdaysLong.${((today.data?.weekday ?? 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`,
                ),
                visited: progress.visited,
                planned: progress.planned,
              })}
            </Text>
            {stops.open.length + stops.done.length === 0 ? (
              <EmptyState
                icon={<MapPinned size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.visits.empty')}
                hint={t('mobile.visits.emptyHint')}
              />
            ) : null}
            {stops.open.length > 0 ? (
              <View style={styles.card}>{stops.open.map(stopRow)}</View>
            ) : null}
            {stops.done.length > 0 ? (
              <>
                <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
                  {t('mobile.visits.done', { n: stops.done.length })}
                </Text>
                <View style={styles.card}>{stops.done.map(stopRow)}</View>
              </>
            ) : null}
          </>
        ) : (collections.data ?? []).length === 0 ? (
          <EmptyState
            icon={<MapPinned size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.visits.noMoney')}
            hint={t('mobile.visits.noMoneyHint')}
          />
        ) : (
          <View style={[styles.card, styles.cardTop]}>
            {(collections.data ?? []).map(moneyRow)}
          </View>
        )}
      </ScrollView>
      {tab === 'today' ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PillButton
            title={t('mobile.visits.addStore')}
            icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
            onPress={() => setPicking(true)}
          />
        </View>
      ) : null}
      <StorePicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(picked) => open(picked)}
      />
      <Sheet
        visible={store !== null}
        fit
        onClose={() => setStore(null)}
        closeLabel={t('mobile.visits.close')}
        header={
          <SheetHeader
            title={store?.name ?? ''}
            right={<SheetClose onPress={() => setStore(null)} label={t('mobile.visits.close')} />}
          />
        }
        footer={
          <PillButton
            title={t('mobile.visits.save')}
            disabled={!ready}
            loading={markVisit.isPending || report.isPending}
            onPress={() => void save()}
          />
        }
      >
        <View style={styles.sheetBody}>
          <ProblemText problem={problem} />
          <View style={styles.chips}>
            {RESULTS.map((value) => (
              <ChoiceChip
                key={value}
                label={t(`mobile.visits.results.${value}`)}
                selected={result === value}
                onPress={() => setResult(value)}
              />
            ))}
          </View>
          {result === 'PAYMENT' ? (
            <>
              <View style={styles.card}>
                <InputRow
                  label={t('mobile.visits.amount')}
                  labelWidth={96}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="numeric"
                  placeholder={t('mobile.visits.amountPlaceholder')}
                />
              </View>
              <Segmented
                options={METHODS.map((value) => ({
                  value,
                  label: t(`mobile.visits.methods.${value}`),
                }))}
                value={method}
                onChange={setMethod}
              />
              <Text style={type.secondary}>{t('mobile.visits.moneyHint')}</Text>
            </>
          ) : null}
          <View style={styles.card}>
            <InputRow
              label={t('mobile.visits.note')}
              labelWidth={96}
              value={note}
              onChangeText={setNote}
              maxLength={500}
              placeholder={t('mobile.visits.notePlaceholder')}
            />
          </View>
        </View>
      </Sheet>
    </Page>
  );
}

/** A store outside today's round, found by name, code or phone. */
function StorePicker(props: {
  visible: boolean;
  onClose: () => void;
  onPick: (store: Store) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const customers = useCustomers(q);
  const rows = customers.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      closeLabel={t('mobile.visits.close')}
      header={
        <SheetHeader
          title={t('mobile.visits.addStore')}
          right={<SheetClose onPress={props.onClose} label={t('mobile.visits.close')} />}
        />
      }
    >
      <View style={styles.pickerSearch}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('mobile.visits.searchStore')}
          autoFocus
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pickerList}>
        {customers.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : (
          <View style={styles.card}>
            {rows.map((row, index) => (
              <View key={row.id}>
                {index > 0 ? <Separator /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    props.onPick({ customerId: row.id, name: row.name, address: row.address })
                  }
                  style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
                >
                  <Text style={type.rowStrong} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={type.secondary} numberOfLines={1}>
                    {row.address ?? row.code}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 14, paddingTop: spacing.md },
  list: { paddingHorizontal: 14, flexGrow: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { backgroundColor: colors.accent },
  problem: { marginTop: spacing.md },
  loading: { marginTop: spacing.xl },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  cardTop: { marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  dot: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  hold: { color: colors.destructiveText },
  moneyRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  status: { fontFamily: fonts.semibold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.input,
  },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerSearch: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  pickerList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  pickRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
});
