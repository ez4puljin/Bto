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
import { colors, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, SearchField, Segmented } from '../../../src/ui/controls';
import { InputRow, Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { Card, FooterBar, Pill, ProgressBar, type Tone } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';
import { BandSegmented } from '../../../src/visits/band-segmented';
import { amountOf, orderedStops, progressOf } from '../../../src/visits/stops';

const RESULTS: readonly VisitResult[] = ['ORDERED', 'NO_ORDER', 'CLOSED', 'PAYMENT'];
const METHODS: readonly CollectionMethod[] = ['CASH', 'TRANSFER'];
type Tab = 'today' | 'money';

interface Store {
  customerId: number;
  name: string;
  address: string | null;
}

const STATUS_TONE: Record<RepCollection['status'], Tone> = {
  PENDING: 'warn',
  RECORDED: 'ok',
  REJECTED: 'bad',
};

/** What a visit came to, as its pill colours it (the Visits board). */
const RESULT_TONE: Record<VisitResult, Tone> = {
  ORDERED: 'ok',
  NO_ORDER: 'warn',
  CLOSED: 'neutral',
  PAYMENT: 'info',
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
      {index > 0 ? <Separator inset={spacing.lg + 24 + spacing.md} /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          open({ customerId: stop.customerId, name: stop.name, address: stop.address })
        }
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.dot, stop.visit ? styles.dotDone : null]}>
          {stop.visit ? <Check size={16} strokeWidth={3} color={colors.primaryForeground} /> : null}
        </View>
        <View style={styles.grow}>
          <Text style={stop.visit ? type.row : type.rowStrong} numberOfLines={1}>
            {stop.name}
          </Text>
          {stop.visit ? (
            <Text style={[type.secondary, tabular]} numberOfLines={1}>
              {[
                ubTime(stop.visit.visitedAt),
                stop.planned ? null : t('mobile.visits.extra'),
                stop.visit.note,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : stop.address ? (
            <Text style={type.secondary} numberOfLines={1}>
              {stop.address}
            </Text>
          ) : null}
        </View>
        {stop.visit ? (
          <Pill
            label={t(`mobile.visits.results.${stop.visit.result}`)}
            tone={RESULT_TONE[stop.visit.result]}
            style={styles.pill}
          />
        ) : stop.creditHold ? (
          <Pill label={t('mobile.visits.hold')} tone="dark" style={styles.pill} />
        ) : (
          <Pill label={t('mobile.visits.notVisited')} style={styles.pill} />
        )}
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
          <Text style={[type.rowStrong, tabular]}>{`${formatMnt(row.amount)}₮`}</Text>
        </View>
        <View style={styles.rowTop}>
          <Text style={[type.secondary, styles.rowTitle]} numberOfLines={1}>
            {[shortDate(row.collectedOn), t(`mobile.visits.methods.${row.method}`), row.note]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Pill
            label={t(`mobile.visits.statuses.${row.status}`)}
            tone={STATUS_TONE[row.status]}
            style={styles.pill}
          />
        </View>
        {row.status === 'REJECTED' && row.decisionNote ? (
          <Text style={[type.secondary, styles.rejected]}>
            {t('mobile.visits.rejectedWhy', { reason: row.decisionNote })}
          </Text>
        ) : row.status === 'RECORDED' && row.paymentNumber ? (
          <Text style={type.secondary}>
            {t('mobile.visits.recordedAs', { number: row.paymentNumber })}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const query = tab === 'today' ? today : collections;
  const total = stops.open.length + stops.done.length;
  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.visits.title')} onBack={() => router.back()}>
        <BandSegmented
          options={[
            { value: 'today', label: t('mobile.visits.tabs.today') },
            { value: 'money', label: t('mobile.visits.tabs.money') },
          ]}
          value={tab}
          onChange={setTab}
          label={t('mobile.visits.title')}
        />
      </StoreHeader>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.list,
          tab === 'today' ? null : { paddingBottom: spacing.xl + insets.bottom },
        ]}
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
            <Card style={styles.progress}>
              <View style={styles.rowTop}>
                <Text accessibilityRole="header" style={[type.rowStrong, styles.rowTitle]}>
                  {t(
                    `mobile.weekdaysLong.${((today.data?.weekday ?? 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`,
                  )}
                </Text>
                <Text style={[type.rowStrong, tabular, styles.link]}>
                  {t('mobile.visits.progressCount', {
                    visited: progress.visited,
                    planned: progress.planned,
                  })}
                </Text>
              </View>
              <ProgressBar value={progress.planned > 0 ? progress.visited / progress.planned : 0} />
            </Card>
            {total === 0 ? (
              <EmptyState
                icon={<MapPinned size={44} strokeWidth={1.5} color={colors.muted} />}
                title={t('mobile.visits.empty')}
                hint={t('mobile.visits.emptyHint')}
              />
            ) : null}
            {stops.open.length > 0 ? (
              <>
                <SectionHeader style={styles.section}>
                  {t('mobile.visits.open', { n: stops.open.length })}
                </SectionHeader>
                <Card flush>{stops.open.map(stopRow)}</Card>
              </>
            ) : null}
            {stops.done.length > 0 ? (
              <>
                <SectionHeader style={styles.section}>
                  {t('mobile.visits.done', { n: stops.done.length })}
                </SectionHeader>
                <Card flush>{stops.done.map(stopRow)}</Card>
              </>
            ) : null}
          </>
        ) : (collections.data ?? []).length === 0 ? (
          <EmptyState
            icon={<MapPinned size={44} strokeWidth={1.5} color={colors.muted} />}
            title={t('mobile.visits.noMoney')}
            hint={t('mobile.visits.noMoneyHint')}
          />
        ) : (
          <Card flush>{(collections.data ?? []).map(moneyRow)}</Card>
        )}
      </ScrollView>
      {tab === 'today' ? (
        <FooterBar>
          <PillButton
            title={t('mobile.visits.addStore')}
            variant="soft"
            icon={<Plus size={18} strokeWidth={2.4} color={colors.link} />}
            onPress={() => setPicking(true)}
            style={styles.fill}
          />
        </FooterBar>
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
  scroll: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  fill: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 1 },
  pressed: { backgroundColor: colors.accent },
  problem: { marginTop: 0 },
  loading: { marginTop: spacing.xl },
  // A label sits 8 px over its card inside the page's 12 px rhythm.
  section: { marginTop: spacing.xs, marginBottom: -spacing.xs },
  progress: { gap: spacing.sm, paddingVertical: 14 },
  link: { color: colors.link },
  card: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  pill: { alignSelf: 'center', flexShrink: 0 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.tint.green, borderColor: colors.tint.green },
  moneyRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
  rejected: { color: colors.destructiveText },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerSearch: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  pickerList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  pickRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
});
