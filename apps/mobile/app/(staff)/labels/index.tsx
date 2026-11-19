import { useQuery } from '@tanstack/react-query';
import { isErrorCode } from '@tugeel/shared/errors';
import { useRouter } from 'expo-router';
import { Bluetooth, Monitor, ScanLine, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { formatMnt } from '../../../src/format/format';
import { fetchTills, productByBarcode, searchProducts } from '../../../src/labels/api';
import { BluetoothError } from '../../../src/labels/bluetooth';
import { CopiesStepper } from '../../../src/labels/copies-stepper';
import {
  addProduct,
  itemsOf,
  type LabelLine,
  type LabelProduct,
  listFrom,
  listKey,
  MAX_LABELS,
  removeLine,
  setCopies,
  totalLabels,
} from '../../../src/labels/list';
import { EMPTY_PREFS, type LabelPrefs, prefsFrom, prefsKey } from '../../../src/labels/prefs';
import { PrintFailure, printLabels } from '../../../src/labels/print';
import { ProductCard } from '../../../src/labels/product-card';
import { PrinterSheet } from '../../../src/labels/printer-sheet';
import { LabelScanner, type ScanOutcome } from '../../../src/labels/scanner';
import { useStored } from '../../../src/labels/use-stored';
import { useDebounced } from '../../../src/state/use-debounced';
import { useSignedIn } from '../../../src/state/session';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, SearchField } from '../../../src/ui/controls';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { FooterBar, Notice } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** What went wrong in words: the printer's own failure, or the server's problem. */
type Failure = { text: string; detail?: string } | { problem: AppProblem };

/**
 * «Үнийн шошго»: a seller prints price labels of their till's products — found by name, code or
 * barcode, or scanned one after another into «Хэвлэх жагсаалт» — one at once or the whole list in
 * one go, on a Bluetooth printer paired with the phone or a printer attached to a PC. The server
 * draws the labels; the list and the choices stay on the phone between visits.
 */
export default function LabelsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { server, me, session } = useSignedIn();
  const client = session.client;

  const prefs = useStored<LabelPrefs>(
    prefsKey(server, me.id),
    EMPTY_PREFS,
    prefsFrom,
    (value) => value.tillId === null && value.printer === null,
  );
  const stored = useStored<LabelLine[]>(
    listKey(server, me.id),
    [],
    listFrom,
    (value) => value.length === 0,
  );
  const list = stored.value;
  const setList = stored.set;
  // The list as the last scan left it: scans come faster than a render.
  const latest = useRef(list);
  latest.current = list;

  const tills = useQuery({ queryKey: ['labels', 'tills'], queryFn: () => fetchTills(client) });
  const till = useMemo(() => {
    const all = tills.data ?? [];
    return all.find((one) => one.id === prefs.value.tillId) ?? all[0] ?? null;
  }, [tills.data, prefs.value.tillId]);
  const tillId = till?.id ?? null;

  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const results = useQuery({
    queryKey: ['labels', 'products', tillId, q],
    queryFn: () => searchProducts(client, tillId ?? 0, q),
    enabled: tillId !== null && q.length > 0,
  });

  const [picked, setPicked] = useState<LabelProduct | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState<'one' | 'all' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const total = totalLabels(list);

  const saveList = useCallback(
    (next: LabelLine[]) => {
      latest.current = next;
      setList(next);
    },
    [setList],
  );

  const tellLimit = useCallback(
    () => toast.show({ message: t('mobile.labels.limitReached', { max: MAX_LABELS }) }),
    [toast, t],
  );

  const add = (product: LabelProduct, copies: number) => {
    const changed = addProduct(latest.current, product, copies);
    saveList(changed.list);
    if (changed.capped) tellLimit();
    else toast.show({ message: t('mobile.labels.added') });
  };

  const onCode = async (code: string): Promise<ScanOutcome> => {
    if (tillId === null) return null;
    try {
      const product = await productByBarcode(client, tillId, code);
      if (!product) return { found: false, code };
      const changed = addProduct(latest.current, product, 1);
      saveList(changed.list);
      return { found: true, name: product.name, price: formatMnt(product.price) };
    } catch {
      return { found: false, code };
    }
  };

  const run = async (lines: LabelLine[], mode: 'one' | 'all', done: (labels: number) => void) => {
    const printer = prefs.value.printer;
    if (tillId === null || !printer) {
      setPrinterOpen(true);
      return;
    }
    setFailure(null);
    setPrinting(mode);
    try {
      done(await printLabels(client, tillId, printer, itemsOf(lines)));
    } catch (error) {
      if (error instanceof BluetoothError) {
        setFailure({ text: t(`mobile.labels.errors.${error.failure}`) });
      } else if (error instanceof PrintFailure) {
        setFailure({
          text:
            error.code && isErrorCode(error.code)
              ? t(`errors.${error.code}`)
              : t(`mobile.labels.errors.${error.failure}`),
          ...(error.detail ? { detail: error.detail } : {}),
        });
      } else {
        setFailure({ problem: problemFrom(error) });
      }
    } finally {
      setPrinting(null);
    }
  };

  const printOne = (product: LabelProduct, copies: number) =>
    void run([{ ...product, copies }], 'one', (labels) => {
      toast.show({ message: t('mobile.labels.printed', { labels: labels || copies }) });
    });

  const printAll = () => {
    const before = latest.current;
    void run(before, 'all', (labels) => {
      saveList([]);
      toast.show({
        message: t('mobile.labels.printed', { labels: labels || totalLabels(before) }),
        action: { label: t('mobile.labels.undo'), onPress: () => saveList(before) },
        durationMs: 8_000,
      });
    });
  };

  // A new printer starts without the last one's failure.
  useEffect(() => {
    setFailure(null);
  }, [prefs.value.printer]);

  const printer = prefs.value.printer;
  const printerLabel = printer
    ? printer.kind === 'bluetooth'
      ? printer.name
      : t('mobile.labels.pcPrinter')
    : t('mobile.labels.noPrinter');
  const searching = q.length > 0;

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.labels.title')} onBack={() => router.back()} right={null} />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {tills.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : tills.error ? (
          <View style={styles.gap}>
            <ProblemText problem={problemFrom(tills.error)} />
            <PillButton
              title={t('mobile.labels.refresh')}
              variant="soft"
              onPress={() => void tills.refetch()}
            />
          </View>
        ) : (
          <>
            <Group>
              {(tills.data ?? []).length > 1 ? (
                <View style={styles.tills}>
                  <Text style={type.secondary}>{t('mobile.labels.till')}</Text>
                  <View style={styles.chips}>
                    {(tills.data ?? []).map((one) => (
                      <ChoiceChip
                        key={one.id}
                        compact
                        onWhite
                        label={`${one.storeName} · ${one.name}`}
                        selected={one.id === tillId}
                        onPress={() => prefs.set((value) => ({ ...value, tillId: one.id }))}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <Row
                  title={t('mobile.labels.till')}
                  value={till ? `${till.storeName} · ${till.name}` : null}
                />
              )}
              <Row
                title={t('mobile.labels.printer')}
                value={printerLabel}
                icon={
                  printer?.kind === 'pc' ? (
                    <Monitor size={20} strokeWidth={2} color={colors.primary} />
                  ) : (
                    <Bluetooth size={20} strokeWidth={2} color={colors.primary} />
                  )
                }
                onPress={() => setPrinterOpen(true)}
              />
            </Group>

            <View style={styles.searchRow}>
              <SearchField
                style={styles.search}
                value={text}
                onChangeText={(next) => {
                  setText(next);
                  setPicked(null);
                }}
                placeholder={t('mobile.labels.searchPlaceholder')}
                accessibilityLabel={t('mobile.labels.searchPlaceholder')}
              />
            </View>
            <PillButton
              title={t('mobile.labels.scan')}
              variant="soft"
              disabled={tillId === null}
              icon={<ScanLine size={20} strokeWidth={2} color={colors.secondaryForeground} />}
              onPress={() => setScanning(true)}
            />

            {failure ? (
              'problem' in failure ? (
                <ProblemText problem={failure.problem} />
              ) : (
                <Notice tone="bad">
                  {failure.detail ? `${failure.text}\n${failure.detail}` : failure.text}
                </Notice>
              )
            ) : null}

            {searching ? (
              results.isFetching && !results.data ? (
                <ActivityIndicator color={colors.primary} />
              ) : results.error ? (
                <ProblemText problem={problemFrom(results.error)} />
              ) : (results.data ?? []).length === 0 ? (
                <Text style={[type.body, styles.hint]}>{t('mobile.labels.noResults')}</Text>
              ) : (
                <Group>
                  {(results.data ?? []).map((product) => (
                    <Row
                      key={product.productId}
                      title={product.name}
                      subtitle={product.code}
                      value={`${formatMnt(product.price)}₮`}
                      chevron={false}
                      checked={picked?.productId === product.productId}
                      onPress={() => setPicked(product)}
                    />
                  ))}
                </Group>
              )
            ) : null}

            {picked ? (
              <ProductCard
                key={picked.productId}
                product={picked}
                busy={printing === 'one'}
                onPrint={(copies) => printOne(picked, copies)}
                onAdd={(copies) => add(picked, copies)}
              />
            ) : null}

            <View>
              <SectionHeader
                right={
                  list.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => saveList([])}
                      hitSlop={8}
                      style={styles.clear}
                    >
                      <Trash2 size={16} strokeWidth={2} color={colors.destructive} />
                      <Text style={[type.bodyStrong, { color: colors.destructive }]}>
                        {t('mobile.labels.clear')}
                      </Text>
                    </Pressable>
                  ) : null
                }
              >
                {t('mobile.labels.list', { products: list.length, labels: total })}
              </SectionHeader>
              {list.length === 0 ? (
                <EmptyState title={t('mobile.labels.empty')} hint={t('mobile.labels.emptyHint')} />
              ) : (
                <Group>
                  {list.map((line) => (
                    <View key={line.productId} style={styles.line}>
                      <View style={styles.lineText}>
                        <Text style={type.rowStrong} numberOfLines={2}>
                          {line.name}
                        </Text>
                        <Text style={type.secondary} numberOfLines={1}>
                          {`${line.code} · ${formatMnt(line.price)}₮`}
                        </Text>
                      </View>
                      <CopiesStepper
                        small
                        value={line.copies}
                        onChange={(copies) => {
                          const changed = setCopies(latest.current, line.productId, copies);
                          saveList(changed.list);
                          if (changed.capped) tellLimit();
                        }}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.labels.remove')}
                        hitSlop={8}
                        onPress={() => saveList(removeLine(latest.current, line.productId))}
                        style={styles.remove}
                      >
                        <X size={18} strokeWidth={2.2} color={colors.muted} />
                      </Pressable>
                    </View>
                  ))}
                </Group>
              )}
              <Text style={[type.caption, styles.limit]}>
                {t('mobile.labels.limit', { max: MAX_LABELS })}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <FooterBar>
        <PillButton
          title={t('mobile.labels.printAll', { labels: total })}
          disabled={total === 0 || tillId === null || !stored.ready}
          loading={printing === 'all'}
          onPress={printAll}
          style={styles.grow}
        />
      </FooterBar>

      <PrinterSheet
        visible={printerOpen}
        onClose={() => setPrinterOpen(false)}
        client={client}
        value={printer}
        onChange={(next) => prefs.set((value) => ({ ...value, printer: next }))}
      />
      <LabelScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onCode={onCode}
        total={total}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  gap: { gap: spacing.md },
  grow: { flex: 1 },
  tills: { padding: spacing.md, gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  searchRow: { flexDirection: 'row' },
  search: { flex: 1 },
  hint: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.md },
  clear: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  lineText: { flex: 1, gap: 2 },
  remove: { padding: spacing.xs },
  limit: { marginTop: spacing.sm, textAlign: 'center' },
});
