import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import {
  CircleCheck,
  ClipboardCheck,
  Package,
  Plus,
  ScanLine,
  Send,
  TriangleAlert,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
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
import { baseQtyOf, isPack, sameQty, totalAfter } from '../../../src/counts/rules';
import { ubTime } from '../../../src/dates/dates';
import { useLeaveGuard } from '../../../src/expiry/leave-guard';
import { HeaderSearch } from '../../../src/expiry/parts';
import { cleanQty, createTurns, isAwaitingRows } from '../../../src/expiry/rules';
import { formatCount, formatQty } from '../../../src/format/format';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { Card, FooterBar, Notice, Pill } from '../../../src/ui/staff-kit';
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
 * pressed even when nothing was counted: leaving before it reminds. The three states of the screen
 * (not begun, a product chosen, the history) share the cards, the bar under the page and one
 * button height.
 */
export default function CountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
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
      subtitle={count?.scopeLabel ?? null}
      onBack={() => router.back()}
    >
      {counting && !product ? (
        <HeaderSearch
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.counts.search')}
          label={t('mobile.shop.searchLabel')}
          onScan={() => setScanning(true)}
          scanLabel={t('mobile.counts.scan')}
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
    <Card style={styles.about}>
      <Text style={type.heading}>{count.warehouseName}</Text>
      <Text style={type.secondary}>{count.scopeLabel}</Text>
      {count.note ? <Text style={type.body}>{count.note}</Text> : null}
    </Card>
  );

  // Not counting: the count was closed, or this person has not begun (or has sent and may go on).
  if (!counting) {
    return (
      <Page edges={[]}>
        {header}
        <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
          {about}
          {!open ? (
            <EmptyState title={t('mobile.counts.closed')} hint={t('mobile.counts.closedHint')} />
          ) : count.mine === 'SENT' ? (
            <EmptyState
              icon={<ClipboardCheck size={44} strokeWidth={1.5} color={colors.success} />}
              title={t('mobile.counts.sentTitle')}
              hint={t('mobile.counts.sentHint')}
            />
          ) : (
            <Notice tone="info">{t('mobile.counts.startHint')}</Notice>
          )}
        </ScrollView>
        {open ? (
          <FooterBar column>
            <ProblemText problem={problem} style={styles.flat} />
            <PillButton
              title={
                count.mine === 'SENT' ? t('mobile.counts.startAgain') : t('mobile.counts.start')
              }
              variant={count.mine === 'SENT' ? 'soft' : 'primary'}
              loading={start.isPending}
              onPress={() => void begin()}
            />
          </FooterBar>
        ) : null}
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
    const hint = [
      unit && isPack(unit) && typedBase !== null
        ? t('mobile.counts.inBase', { qty: formatQty(typedBase), unit: base })
        : null,
      total !== null && typedBase !== null
        ? t('mobile.counts.totalAfter', { qty: formatQty(total), unit: base })
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
    return (
      <Page edges={[]}>
        {header}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Card style={styles.product}>
              <View style={styles.productHead}>
                <View style={styles.thumb}>
                  <Package size={24} strokeWidth={1.5} color={colors.input} />
                </View>
                <View style={styles.grow}>
                  <Text style={type.rowStrong} numberOfLines={3}>
                    {product.name}
                  </Text>
                  <Text style={type.secondary} numberOfLines={1}>
                    {product.sku}
                  </Text>
                </View>
                <PillButton
                  title={t('mobile.counts.change')}
                  variant="soft"
                  height={36}
                  style={styles.change}
                  onPress={() => setProduct(null)}
                />
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
              <View style={styles.rule} />
              {units.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : units.error ? (
                <ProblemText problem={problemFrom(units.error)} style={styles.flat} />
              ) : (
                <>
                  {(units.data?.length ?? 0) > 1 ? (
                    <Segmented
                      small={(units.data?.length ?? 0) > 2}
                      options={(units.data ?? []).map((entry) => ({
                        value: String(entry.id),
                        label: isPack(entry)
                          ? t('mobile.counts.pack', {
                              unit: entry.uomName,
                              n: formatQty(entry.factorToBase),
                            })
                          : entry.uomName,
                      }))}
                      value={unit ? String(unit.id) : null}
                      onChange={(value) => {
                        const entry = units.data?.find((option) => String(option.id) === value);
                        if (!entry) return;
                        setProduct({ ...product, unitId: entry.id });
                        setQty((current) => cleanQty(current, entry.fractional));
                      }}
                    />
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
                    hint={hint === '' ? null : hint}
                  />
                  {differs ? (
                    <View accessibilityRole="alert">
                      <Notice icon={TriangleAlert} tone="warn">
                        {t('mobile.counts.mismatch')}
                      </Notice>
                    </View>
                  ) : null}
                </>
              )}
            </Card>
          </ScrollView>
          <FooterBar column>
            <ProblemText problem={problem} style={styles.flat} />
            <PillButton
              title={t('mobile.counts.add')}
              icon={<Plus size={20} strokeWidth={2.4} color={colors.primaryForeground} />}
              loading={add.isPending}
              disabled={typedBase === null || unit === null}
              onPress={() => void save()}
            />
          </FooterBar>
        </KeyboardAvoidingView>
        {sheets}
      </Page>
    );
  }

  return (
    <Page edges={[]}>
      {header}
      <ScrollView
        style={styles.flex}
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
              <View accessibilityRole={last.mismatch ? 'alert' : undefined}>
                <Notice
                  icon={last.mismatch ? TriangleAlert : CircleCheck}
                  tone={last.mismatch ? 'warn' : 'ok'}
                >
                  {lastText(last)}
                </Notice>
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
                      chevron={false}
                      titleStyle={entry.voided ? styles.struck : undefined}
                      right={
                        entry.voided ? (
                          <Pill label={t('mobile.counts.voided')} />
                        ) : (
                          <Text style={[type.rowStrong, tabular]}>
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
        <FooterBar>
          <Text style={[type.secondary, styles.flex]}>{t('mobile.counts.mustSend')}</Text>
          <PillButton
            title={t('mobile.counts.send.button')}
            variant="soft"
            icon={<Send size={18} strokeWidth={2.2} color={colors.link} />}
            loading={send.isPending}
            onPress={() => setConfirming(true)}
          />
        </FooterBar>
      ) : null}
      {sheets}
    </Page>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={[type.heading, tabular]}>{value}</Text>
      <Text style={[type.caption, styles.factLabel]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  body: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  lead: { color: colors.muted, textAlign: 'center' },
  flat: { marginTop: 0 },
  head: { marginTop: spacing.xs },
  about: { gap: spacing.xs },
  product: { gap: spacing.md },
  productHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  change: { paddingHorizontal: spacing.lg },
  facts: { flexDirection: 'row', gap: 10 },
  fact: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  factLabel: { textAlign: 'center' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
});
