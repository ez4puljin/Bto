import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ScanLine } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useBaseUnitFractional,
  useCreateExpiryItem,
  useExpirySummary,
  useOpenExpiryItems,
  useProductSearch,
} from '../../../src/api/expiry';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useBarcodeLookup } from '../../../src/api/transfers';
import { StatusPill } from '../../../src/community/parts';
import { useLeaveGuard } from '../../../src/expiry/leave-guard';
import { ExpiryFields, ExpiryRecordRow, HeaderSearch, LeaveSheet } from '../../../src/expiry/parts';
import {
  type ChosenProduct,
  chosenFromBarcode,
  chosenFromLookup,
  createBodyOf,
  createTurns,
  duplicateChoiceOf,
  EMPTY_EXPIRY_FORM,
  type ExpiryForm,
  hasProblems,
  isAwaitingRows,
  isNewRecordTyped,
  problemsOfNew,
} from '../../../src/expiry/rules';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, fonts, radii, spacing, TOUCH, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { PillButton } from '../../../src/ui/controls';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

type After = 'back' | 'next';

/**
 * A new record (ADR-0172 #5, #9): the camera (at once with `?scan=1`) or a search, then the product
 * with its open records first, the date with its days as it is typed, the two counts and a note.
 * «Хадгалах» goes back to the list; «Хадгалаад дараагийн бараа» clears the form and opens the camera
 * again, for walking a shelf. One Idempotency-Key per product's form until it succeeds. A failed
 * save stays on the screen as typed (no offline mode, ADR-0020), and leaving with something typed
 * asks first.
 */
export default function NewExpiryRecordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const params = useLocalSearchParams<{ scan?: string }>();
  const today = useExpirySummary().data?.today ?? null;
  const lookup = useBarcodeLookup();
  const create = useCreateExpiryItem();

  const [scanning, setScanning] = useState(params.scan === '1');
  const [looking, setLooking] = useState(false);
  const [turns] = useState(createTurns);
  const scroller = useRef<ScrollView>(null);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const [product, setProduct] = useState<ChosenProduct | null>(null);
  const [form, setForm] = useState<ExpiryForm>(EMPTY_EXPIRY_FORM);
  const [checked, setChecked] = useState(false);
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [saving, setSaving] = useState<After | null>(null);
  const [existing, setExisting] = useState<{ itemId: number; after: After } | null>(null);
  // What «Шинээр нэмэх» said yes to, kept until the save succeeds (`duplicateChoiceOf`).
  const [duplicateChoice, setDuplicateChoice] = useState<string | null>(null);
  // The server has seen this form's key with another body: an earlier save landed unheard.
  const [landed, setLanded] = useState<After | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const results = useProductSearch(product ? '' : q);
  const found = results.data ?? [];
  const open = useOpenExpiryItems(product?.id ?? null);
  const fractional = useBaseUnitFractional(product?.id ?? null);
  const problems = problemsOfNew(form, today, fractional);
  const change = (patch: Partial<ExpiryForm>) => setForm((current) => ({ ...current, ...patch }));
  const leaving = useLeaveGuard(isNewRecordTyped(product !== null, form));

  const choose = (next: ChosenProduct) => {
    // A product chosen ends any scan still being looked up, so its late answer cannot swap the
    // product under what gets typed for this one.
    turns.take();
    setLooking(false);
    setProduct(next);
    setProblem(null);
    setText('');
  };

  const onCode = async (code: string) => {
    const turn = turns.take();
    setScanning(false);
    setProblem(null);
    setLooking(true);
    try {
      const found = await lookup(code);
      if (!turns.isLatest(turn)) return;
      if (found) choose(chosenFromBarcode(found));
      else toast.show({ message: t('mobile.expiry.new.unknownBarcode') });
    } catch (error) {
      if (turns.isLatest(turn)) setProblem(problemFrom(error));
    } finally {
      if (turns.isLatest(turn)) setLooking(false);
    }
  };

  /** A new key takes no yes to a duplicate with it: that was given for what the old key sent. */
  const renewKey = () => {
    const fresh = Crypto.randomUUID();
    setKey(fresh);
    setDuplicateChoice(null);
    return fresh;
  };

  /** Each product's form has its own key, so a refused key can only be about this product. */
  const changeProduct = () => {
    setProduct(null);
    setLanded(null);
    renewKey();
  };

  const save = async (after: After, how: { addAnyway?: boolean; key?: string } = {}) => {
    if (!product) return;
    setChecked(true);
    setProblem(null);
    setLanded(null);
    if (hasProblems(problems)) return;
    setSaving(after);
    const choice = duplicateChoiceOf(product.id, form);
    const addAnyway = how.addAnyway === true;
    if (addAnyway) setDuplicateChoice(choice);
    const allowDuplicate = addAnyway || (how.key === undefined && duplicateChoice === choice);
    try {
      await create.mutateAsync({
        key: how.key ?? key,
        body: createBodyOf(product.id, form, allowDuplicate),
      });
      renewKey();
      toast.show({ message: t('mobile.expiry.new.saved') });
      // The person may have left while this was answered, and neither going back nor the camera
      // may then land on the screen they are on now.
      const stillHere = navigation.isFocused();
      if (after === 'back' && stillHere) {
        leaving.release();
        router.back();
        return;
      }
      // Whoever comes back to this screen finds no saved values passing for typed ones.
      setProduct(null);
      setForm(EMPTY_EXPIRY_FORM);
      setChecked(false);
      if (after === 'next') {
        setLastSaved(product.name);
        setScanning(stillHere);
      }
    } catch (error) {
      const failure = problemFrom(error);
      const itemId = failure.params?.itemId;
      if (failure.code === 'EXPIRY_ITEM_EXISTS' && typeof itemId === 'number') {
        setExisting({ itemId, after });
      } else if (failure.code === 'IDEMPOTENCY_KEY_REUSED') {
        // An earlier save landed although its answer never came, and something has changed since.
        // Nothing is sent again unasked: that record may hold the very values just corrected. The
        // hook's refresh of `['expiry']`, started with this answer, brings it into the open records.
        setLanded(after);
        scroller.current?.scrollTo({ y: 0 });
      } else {
        setProblem(failure);
      }
    } finally {
      setSaving(null);
    }
  };

  /** A record beside the one that landed, on the person's word; the server may still ask. */
  const addAnother = () => {
    if (landed) void save(landed, { key: renewKey() });
  };

  const openRecords = open.data?.data ?? [];

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.expiry.new.title')} onBack={() => router.back()} right={null}>
        {product ? null : (
          <HeaderSearch
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.expiry.new.search')}
            label={t('mobile.shop.searchLabel')}
            autoFocus={!scanning}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.expiry.scan')}
                onPress={() => setScanning(true)}
                style={({ pressed }) => [styles.scanButton, pressed && styles.faded]}
              >
                <ScanLine size={22} strokeWidth={1.9} color={colors.primary} />
              </Pressable>
            }
          />
        )}
      </StoreHeader>

      {product ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView
            ref={scroller}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
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
                  onPress={changeProduct}
                  style={({ pressed }) => [styles.change, pressed && styles.faded]}
                >
                  <Text style={styles.changeText}>{t('mobile.expiry.new.change')}</Text>
                </Pressable>
              </View>
              <Text style={type.body}>
                {t('mobile.expiry.new.baseUnit', { unit: product.baseUnit })}
              </Text>
              {product.pack ? (
                <View style={styles.pack}>
                  <Text style={styles.packText}>
                    {t('mobile.expiry.new.pack', {
                      unit: product.pack.unit,
                      n: product.pack.n,
                      base: product.baseUnit,
                    })}
                  </Text>
                </View>
              ) : null}
            </View>

            {openRecords.length > 0 ? (
              <View>
                <SectionHeader style={styles.head}>{t('mobile.expiry.new.open')}</SectionHeader>
                <View style={styles.openRows}>
                  {openRecords.map((item) => (
                    <ExpiryRecordRow
                      key={item.id}
                      item={item}
                      showProduct={false}
                      onPress={() => router.push(`/expiry/${item.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.card}>
              <ExpiryFields
                form={form}
                onChange={change}
                problems={problems}
                checked={checked}
                today={today}
                fractional={fractional}
                unit={product.baseUnit}
              />
            </View>
          </ScrollView>
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <ProblemText problem={problem} style={styles.barProblem} />
            {landed ? (
              <>
                <View accessibilityRole="alert" style={styles.landed}>
                  <Text style={styles.landedText}>{t('mobile.expiry.new.landed')}</Text>
                </View>
                <PillButton
                  title={t('mobile.expiry.new.addAnyway')}
                  height={46}
                  onPress={addAnother}
                />
                <PillButton
                  title={t('common.cancel')}
                  variant="soft"
                  height={46}
                  onPress={() => setLanded(null)}
                />
              </>
            ) : (
              <>
                <PillButton
                  title={t('mobile.expiry.new.saveNext')}
                  height={46}
                  loading={saving === 'next'}
                  disabled={saving !== null}
                  onPress={() => void save('next')}
                />
                <PillButton
                  title={t('common.save')}
                  variant="soft"
                  height={46}
                  loading={saving === 'back'}
                  disabled={saving !== null}
                  onPress={() => void save('back')}
                />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {looking ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
          <ProblemText problem={problem} style={styles.searchProblem} />
          {q === '' ? (
            <>
              <Text style={[type.body, styles.lead]}>{t('mobile.expiry.new.lead')}</Text>
              <PillButton
                title={t('mobile.expiry.scan')}
                icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
                onPress={() => setScanning(true)}
              />
            </>
          ) : isAwaitingRows(results, found.length) ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : results.error ? (
            <ProblemText problem={problemFrom(results.error)} style={styles.searchProblem} />
          ) : found.length === 0 ? (
            <EmptyState title={t('mobile.expiry.new.noResults')} />
          ) : (
            <Group>
              {found.map((item) => (
                <Row
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.sku} · ${item.baseUnit.uomName}`}
                  minHeight={TOUCH + spacing.sm}
                  right={
                    item.status === 'INACTIVE' ? (
                      <StatusPill
                        label={t('catalog.products.status.INACTIVE')}
                        background={colors.fill}
                        color={colors.muted}
                      />
                    ) : null
                  }
                  onPress={() => choose(chosenFromLookup(item))}
                />
              ))}
            </Group>
          )}
        </ScrollView>
      )}

      <ScanSheet
        visible={scanning}
        hint={
          lastSaved
            ? t('mobile.expiry.new.savedHint', { name: lastSaved })
            : t('mobile.expiry.new.scanHint')
        }
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(false)}
      />

      <ActionSheet
        visible={existing !== null}
        title={t('mobile.expiry.new.existsTitle')}
        message={t('mobile.expiry.new.existsMessage')}
        actions={[
          {
            label: t('mobile.expiry.new.openExisting'),
            onPress: () => {
              const itemId = existing?.itemId;
              setExisting(null);
              if (itemId !== undefined) router.push(`/expiry/${itemId}`);
            },
          },
          {
            label: t('mobile.expiry.new.addAnyway'),
            onPress: () => {
              const after = existing?.after;
              setExisting(null);
              if (after) void save(after, { addAnyway: true });
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setExisting(null)}
      />
      <LeaveSheet guard={leaving} />
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  faded: { opacity: 0.7 },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  lead: { color: colors.muted, textAlign: 'center' },
  searchProblem: { marginTop: 0 },
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
  pack: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.secondary,
  },
  packText: { ...type.body, fontFamily: fonts.medium, color: colors.secondaryForeground },
  head: { marginTop: spacing.xs },
  openRows: { gap: spacing.sm },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
  barProblem: { marginTop: 0 },
  landed: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
  },
  landedText: { ...type.body, color: colors.warningText },
});
