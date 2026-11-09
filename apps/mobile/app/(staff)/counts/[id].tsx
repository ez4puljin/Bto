import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ClipboardCheck, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type StockCountEntry,
  useCountMutations,
  useCountProductInfo,
  useCountUnits,
  useMyCount,
} from '../../../src/api/counts';
import { useProductSearch } from '../../../src/api/expiry';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useBarcodeLookup } from '../../../src/api/transfers';
import { StatusPill } from '../../../src/community/parts';
import { baseQtyOf, isPack, sameQty, totalAfter } from '../../../src/counts/rules';
import { ubTime } from '../../../src/dates/dates';
import { useLeaveGuard } from '../../../src/expiry/leave-guard';
import { HeaderSearch } from '../../../src/expiry/parts';
import { cleanQty, createTurns, isAwaitingRows } from '../../../src/expiry/rules';
import { formatCount, formatQty } from '../../../src/format/format';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, radii, spacing, TOUCH, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { ChoiceChip, PillButton } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

interface Chosen {
  id: number;
  sku: string;
  name: string;
  /** The unit the barcode was of (a box's barcode counts in boxes); null picks the base unit. */
  unitId: number | null;
  scanned: boolean;
}

/** What the last number did, shown until the next one: the scanner's hint and the list's banner. */
interface Last {
  name: string;
  qty: string;
  unit: string;
  /** Set when the count shows the stock and the two differ. */
  mismatch: { counted: string; expected: string } | null;
}

/**
 * Counting one count (ADR-0176 #4). «Тоолж эхлэх» opens this person's session; then a scan or a
 * search picks a product and its number is typed at once, in pieces or by the box. A product read
 * again adds to its number, and every number typed stays its own row of the history, where an
 * unsent one can be taken back. «Илгээх» adds the session to the count window, and it must be
 * pressed even when nothing was counted: leaving before it reminds.
 */
export default function CountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number.parseInt(params.id, 10);
  const mine = useMyCount(id);
  const { start, send, add, takeBack } = useCountMutations(id);
  const lookup = useBarcodeLookup();

  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [turns] = useState(createTurns);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const [product, setProduct] = useState<Chosen | null>(null);
  const [qty, setQty] = useState('');
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [taking, setTaking] = useState<StockCountEntry | null>(null);

  const count = mine.data?.count ?? null;
  const counting = mine.data?.session != null;
  const open = mine.data?.status === 'COUNTING';
  const entries = mine.data?.entries ?? [];
  const guard = useLeaveGuard(counting);

  const results = useProductSearch(counting && !product ? q : '');
  const found = results.data ?? [];
  const units = useCountUnits(product?.id ?? null);
  const info = useCountProductInfo(id, product?.id ?? null);
  const unit =
    units.data?.find((entry) => entry.id === product?.unitId) ??
    units.data?.find((entry) => entry.isBase) ??
    null;
  const typedBase = unit ? baseQtyOf(qty, unit.factorToBase) : null;
  const base = units.data?.find((entry) => entry.isBase)?.uomName ?? '';

  const choose = (next: Chosen) => {
    turns.take();
    setLooking(false);
    setProduct(next);
    setQty('');
    setProblem(null);
    setText('');
    setKey(Crypto.randomUUID());
  };

  const onCode = async (code: string) => {
    const turn = turns.take();
    setScanning(false);
    setProblem(null);
    setLooking(true);
    try {
      const hit = await lookup(code);
      if (!turns.isLatest(turn)) return;
      if (hit) {
        choose({
          id: hit.product.id,
          sku: hit.product.sku,
          name: hit.product.name,
          unitId: hit.unit.id,
          scanned: true,
        });
      } else {
        toast.show({ message: t('mobile.counts.unknownBarcode') });
      }
    } catch (error) {
      if (turns.isLatest(turn)) setProblem(problemFrom(error));
    } finally {
      if (turns.isLatest(turn)) setLooking(false);
    }
  };

  const save = async () => {
    if (!product || !unit || typedBase === null || add.isPending) return;
    setProblem(null);
    try {
      const answer = await add.mutateAsync({
        key,
        productId: product.id,
        productUnitId: unit.id,
        qty,
      });
      const mismatch =
        answer.expectedQty !== null &&
        answer.countedQty !== null &&
        !sameQty(answer.expectedQty, answer.countedQty)
          ? { counted: answer.countedQty, expected: answer.expectedQty }
          : null;
      setLast({ name: product.name, qty, unit: unit.uomName, mismatch });
      toast.show({
        message: mismatch ? t('mobile.counts.mismatch') : t('mobile.counts.added'),
      });
      setProduct(null);
      setQty('');
      setKey(Crypto.randomUUID());
      // Whoever scanned goes on scanning; a search goes back to the search.
      if (product.scanned && navigation.isFocused()) setScanning(true);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const sendNow = async (thenLeave: boolean) => {
    setConfirming(false);
    setProblem(null);
    try {
      await send.mutateAsync();
      setLast(null);
      setProduct(null);
      toast.show({ message: t('mobile.counts.sent') });
      if (thenLeave) guard.leave();
    } catch (error) {
      guard.stay();
      setProblem(problemFrom(error));
    }
  };

  const begin = async () => {
    setProblem(null);
    try {
      await start.mutateAsync();
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const lastText = (entry: Last) =>
    entry.mismatch
      ? t('mobile.counts.lastMismatch', {
          name: entry.name,
          counted: formatQty(entry.mismatch.counted),
          expected: formatQty(entry.mismatch.expected),
        })
      : t('mobile.counts.lastAdded', {
          name: entry.name,
          qty: formatQty(entry.qty),
          unit: entry.unit,
        });

  const header = (
    <StoreHeader
      title={count?.warehouseName ?? t('mobile.counts.title')}
      onBack={() => router.back()}
      right={null}
    >
      {counting && !product ? (
        <HeaderSearch
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.counts.search')}
          label={t('mobile.shop.searchLabel')}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.counts.scan')}
              onPress={() => setScanning(true)}
              style={({ pressed }) => [styles.scanButton, pressed && styles.faded]}
            >
              <ScanLine size={22} strokeWidth={1.9} color={colors.primary} />
            </Pressable>
          }
        />
      ) : null}
    </StoreHeader>
  );

  const sheets = (
    <>
      <ScanSheet
        visible={scanning}
        hint={last ? lastText(last) : t('mobile.counts.scanHint')}
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(false)}
      />
      <ActionSheet
        visible={confirming}
        title={t('mobile.counts.send.title')}
        message={
          entries.some((entry) => !entry.voided)
            ? t('mobile.counts.send.message')
            : t('mobile.counts.send.messageEmpty')
        }
        actions={[{ label: t('mobile.counts.send.confirm'), onPress: () => void sendNow(false) }]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirming(false)}
      />
      <ActionSheet
        visible={guard.asking}
        title={t('mobile.counts.leave.title')}
        message={t('mobile.counts.leave.message')}
        actions={[
          { label: t('mobile.counts.leave.send'), onPress: () => void sendNow(true) },
          { label: t('mobile.counts.leave.later'), onPress: guard.leave },
        ]}
        cancelLabel={t('mobile.counts.leave.stay')}
        onCancel={guard.stay}
      />
      <ActionSheet
        visible={taking !== null}
        title={taking?.name ?? ''}
        message={
          taking
            ? t('mobile.counts.takeBack.message', {
                qty: formatQty(taking.enteredQty),
                unit: taking.unitName,
              })
            : ''
        }
        actions={[
          {
            label: t('mobile.counts.takeBack.confirm'),
            destructive: true,
            onPress: () => {
              const entry = taking;
              setTaking(null);
              if (!entry) return;
              takeBack.mutate(entry.id, {
                onSuccess: () => toast.show({ message: t('mobile.counts.takeBack.done') }),
                onError: (error) => setProblem(problemFrom(error)),
              });
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setTaking(null)}
      />
    </>
  );

  if (mine.isPending || mine.error || !count) {
    return (
      <Page edges={[]}>
        {header}
        <View style={styles.body}>
          {mine.error ? (
            <>
              <ProblemText problem={problemFrom(mine.error)} />
              <PillButton
                title={t('common.retry')}
                variant="soft"
                onPress={() => void mine.refetch()}
              />
            </>
          ) : (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          )}
        </View>
      </Page>
    );
  }

  const about = (
    <View style={styles.card}>
      <Text style={type.heading}>{count.warehouseName}</Text>
      <Text style={type.secondary}>{count.scopeLabel}</Text>
      {count.note ? <Text style={type.body}>{count.note}</Text> : null}
    </View>
  );

  // Not counting: the count was closed, or this person has not begun (or has sent and may go on).
  if (!counting) {
    return (
      <Page edges={[]}>
        {header}
        <ScrollView contentContainerStyle={styles.body}>
          {about}
          {!open ? (
            <EmptyState title={t('mobile.counts.closed')} hint={t('mobile.counts.closedHint')} />
          ) : (
            <>
              {count.mine === 'SENT' ? (
                <EmptyState
                  icon={<ClipboardCheck size={44} strokeWidth={1.5} color={colors.success} />}
                  title={t('mobile.counts.sentTitle')}
                  hint={t('mobile.counts.sentHint')}
                />
              ) : (
                <Text style={[type.body, styles.lead]}>{t('mobile.counts.startHint')}</Text>
              )}
              <ProblemText problem={problem} style={styles.flat} />
              <PillButton
                title={
                  count.mine === 'SENT' ? t('mobile.counts.startAgain') : t('mobile.counts.start')
                }
                variant={count.mine === 'SENT' ? 'soft' : 'primary'}
                loading={start.isPending}
                onPress={() => void begin()}
              />
            </>
          )}
        </ScrollView>
        {sheets}
      </Page>
    );
  }

  if (product) {
    const shown = info.data;
    const total =
      shown && shown.countedQty !== null ? totalAfter(shown.countedQty, typedBase) : null;
    const differs =
      shown && shown.expectedQty !== null && total !== null && typedBase !== null
        ? !sameQty(shown.expectedQty, total)
        : false;
    return (
      <Page edges={[]}>
        {header}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <View style={styles.productHead}>
                <View style={styles.grow}>
                  <Text style={type.heading} numberOfLines={3}>
                    {product.name}
                  </Text>
                  <Text style={type.secondary} numberOfLines={1}>
                    {product.sku}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setProduct(null)}
                  style={({ pressed }) => [styles.change, pressed && styles.faded]}
                >
                  <Text style={styles.changeText}>{t('mobile.counts.change')}</Text>
                </Pressable>
              </View>
              {shown ? (
                <View style={styles.facts}>
                  <Fact label={t('mobile.counts.myQty')} value={formatQty(shown.myQty)} />
                  {shown.countedQty !== null ? (
                    <Fact label={t('mobile.counts.counted')} value={formatQty(shown.countedQty)} />
                  ) : null}
                  {shown.expectedQty !== null ? (
                    <Fact label={t('mobile.counts.stock')} value={formatQty(shown.expectedQty)} />
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              {units.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : units.error ? (
                <ProblemText problem={problemFrom(units.error)} style={styles.flat} />
              ) : (
                <>
                  {(units.data?.length ?? 0) > 1 ? (
                    <View style={styles.units}>
                      {units.data?.map((entry) => (
                        <ChoiceChip
                          key={entry.id}
                          onWhite
                          label={
                            isPack(entry)
                              ? t('mobile.counts.pack', {
                                  unit: entry.uomName,
                                  n: formatQty(entry.factorToBase),
                                })
                              : entry.uomName
                          }
                          selected={unit?.id === entry.id}
                          onPress={() => {
                            setProduct({ ...product, unitId: entry.id });
                            setQty((current) => cleanQty(current, entry.fractional));
                          }}
                        />
                      ))}
                    </View>
                  ) : null}
                  <TextField
                    label={t('mobile.counts.qty', { unit: unit?.uomName ?? '' })}
                    value={qty}
                    onChangeText={(next) => setQty(cleanQty(next, unit?.fractional ?? false))}
                    keyboardType={unit?.fractional ? 'decimal-pad' : 'number-pad'}
                    autoFocus
                    selectTextOnFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void save()}
                    hint={
                      unit && isPack(unit) && typedBase !== null
                        ? t('mobile.counts.inBase', { qty: formatQty(typedBase), unit: base })
                        : null
                    }
                  />
                  {total !== null && typedBase !== null ? (
                    <Text style={type.body}>
                      {t('mobile.counts.totalAfter', { qty: formatQty(total), unit: base })}
                    </Text>
                  ) : null}
                  {differs ? (
                    <View accessibilityRole="alert" style={styles.warning}>
                      <Text style={styles.warningText}>{t('mobile.counts.mismatch')}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </ScrollView>
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <ProblemText problem={problem} style={styles.flat} />
            <PillButton
              title={t('mobile.counts.add')}
              height={46}
              loading={add.isPending}
              disabled={typedBase === null || unit === null}
              onPress={() => void save()}
            />
          </View>
        </KeyboardAvoidingView>
        {sheets}
      </Page>
    );
  }

  return (
    <Page edges={[]}>
      {header}
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()} />
        }
      >
        {looking ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
        <ProblemText problem={problem} style={styles.flat} />
        {q !== '' ? (
          isAwaitingRows(results, found.length) ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : results.error ? (
            <ProblemText problem={problemFrom(results.error)} style={styles.flat} />
          ) : found.length === 0 ? (
            <EmptyState title={t('mobile.counts.noResults')} />
          ) : (
            <Group>
              {found.map((item) => (
                <Row
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.sku} · ${item.baseUnit.uomName}`}
                  minHeight={TOUCH + spacing.sm}
                  onPress={() =>
                    choose({
                      id: item.id,
                      sku: item.sku,
                      name: item.name,
                      unitId: null,
                      scanned: false,
                    })
                  }
                />
              ))}
            </Group>
          )
        ) : (
          <>
            {last ? (
              <View
                accessibilityRole={last.mismatch ? 'alert' : undefined}
                style={last.mismatch ? styles.warning : styles.note}
              >
                <Text style={last.mismatch ? styles.warningText : styles.noteText}>
                  {lastText(last)}
                </Text>
              </View>
            ) : null}
            <PillButton
              title={t('mobile.counts.scan')}
              icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
              onPress={() => setScanning(true)}
            />
            <View>
              <SectionHeader style={styles.head}>
                {t('mobile.counts.history', { n: formatCount(entries.length) })}
              </SectionHeader>
              {entries.length === 0 ? (
                <Text style={[type.body, styles.lead]}>{t('mobile.counts.historyEmpty')}</Text>
              ) : (
                <Group>
                  {entries.map((entry) => (
                    <Row
                      key={entry.id}
                      title={entry.name}
                      subtitle={`${entry.sku} · ${ubTime(entry.createdAt)}`}
                      minHeight={TOUCH + spacing.sm}
                      chevron={false}
                      titleStyle={entry.voided ? styles.struck : undefined}
                      right={
                        entry.voided ? (
                          <StatusPill
                            label={t('mobile.counts.voided')}
                            background={colors.fill}
                            color={colors.muted}
                          />
                        ) : (
                          <Text style={type.bodyStrong}>
                            {t('mobile.counts.entryQty', {
                              qty: formatQty(entry.enteredQty),
                              unit: entry.unitName,
                            })}
                          </Text>
                        )
                      }
                      onPress={entry.voided ? undefined : () => setTaking(entry)}
                    />
                  ))}
                </Group>
              )}
            </View>
          </>
        )}
      </ScrollView>
      {q === '' ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Text style={[type.secondary, styles.center]}>{t('mobile.counts.mustSend')}</Text>
          <PillButton
            title={t('mobile.counts.send.button')}
            variant="soft"
            height={46}
            loading={send.isPending}
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : null}
      {sheets}
    </Page>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={type.secondary}>{label}</Text>
      <Text style={type.heading}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  faded: { opacity: 0.7 },
  center: { textAlign: 'center' },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  lead: { color: colors.muted, textAlign: 'center' },
  flat: { marginTop: 0 },
  head: { marginTop: spacing.xs },
  scanButton: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  productHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  change: { height: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.sm },
  changeText: { ...type.bodyStrong, color: colors.primary },
  facts: { flexDirection: 'row', gap: spacing.lg },
  fact: { gap: 2 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  warning: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
  },
  warningText: { ...type.body, color: colors.warningText },
  note: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.successSoft,
  },
  noteText: { ...type.body, color: colors.success },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
});
