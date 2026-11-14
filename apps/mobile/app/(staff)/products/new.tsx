import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useNavigation, useRouter } from 'expo-router';
import { Camera, ScanLine, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useHomeWarehouses,
  useNextSku,
  useProductAi,
  useProductAiStatus,
  useRegisterProduct,
  useRegistrationCategories,
  useRegistrationUoms,
  useSupplierSearch,
} from '../../../src/api/product-registration';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useBarcodeLookup } from '../../../src/api/transfers';
import { useLeaveGuard } from '../../../src/expiry/leave-guard';
import { PhotoCamera } from '../../../src/products/photo-camera';
import { PickSheet } from '../../../src/products/pick-sheet';
import {
  type BarcodeSlot,
  baseUnitsOf,
  bodyOf,
  categoryOptions,
  emptyForm,
  filledBy,
  type FormPicture,
  type FormProblem,
  type FormProblemKey,
  hasProblems,
  isTyped,
  MAX_AI_PHOTOS,
  pictureFailureOf,
  type PictureFailure,
  problemsOf,
  type ProductForm,
  type Proposal,
  withBarcode,
  withoutBarcode,
  withProposal,
} from '../../../src/products/rules';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, radii, spacing, TOUCH, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

type Phase = 'idle' | 'uploading' | 'reading' | 'picture';
type Picking = 'category' | 'supplier' | 'warehouse' | null;

/** What the last run of «AI ашиглах» said, shown above the form until the product is saved. */
interface Outcome {
  proposal: Proposal | null;
  readProblem: AppProblem | null;
  pictureFailure: PictureFailure | null;
}

/**
 * «Бараа нэмэх» (ADR-0199): the staff app's registration of a product, by the phone's camera. The
 * registrar photographs the product (front, back, label, barcode) and presses «AI ашиглах»: the
 * photos go up, the model reads them and fills the form from the catalogue's own categories, units
 * and suppliers, and the server finishes the product's picture (cut out, on white, the logo
 * top-left). The registrar checks every field, scans a barcode where the reading missed one, and
 * saves; nothing is saved before that. Without a model the form is typed by hand, without a
 * background service the photo is kept as taken: the screen says which, and works either way.
 */
export default function NewProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { me } = useSignedIn();
  const status = useProductAiStatus();
  const uoms = useRegistrationUoms();
  const categories = useRegistrationCategories();
  const warehouses = useHomeWarehouses();
  const ai = useProductAi();
  const register = useRegisterProduct();
  const lookup = useBarcodeLookup();

  const [form, setForm] = useState<ProductForm>(() =>
    emptyForm({ categoryId: null, supplier: null, homeWarehouseId: null, baseUomId: null }),
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [picture, setPicture] = useState<FormPicture | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [checked, setChecked] = useState(false);
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [shooting, setShooting] = useState(false);
  const [picking, setPicking] = useState<Picking>(null);
  const [scanning, setScanning] = useState<BarcodeSlot | null>(null);
  const [supplierText, setSupplierText] = useState('');
  const supplierQ = useDebounced(supplierText, 300);
  const suppliers = useSupplierSearch(supplierQ, picking === 'supplier');
  const nextSku = useNextSku(form.categoryId);
  const leaving = useLeaveGuard(isTyped(form, picture) || photos.length > 0);

  const units = uoms.data ?? [];
  const baseUnits = baseUnitsOf(units);
  const change = (patch: Partial<ProductForm>) => setForm((current) => ({ ...current, ...patch }));
  const categoryList = useMemo(() => categoryOptions(categories.data ?? []), [categories.data]);
  // The homes this person may register into: their write scope, or every one for an admin.
  const homes = (warehouses.data ?? []).filter(
    (warehouse) =>
      me.writableWarehouseIds === null || me.writableWarehouseIds.includes(warehouse.id),
  );

  // Pieces are what most products are counted in; a single home is chosen for the person.
  const pieces = units.find((unit) => unit.code === 'PCS');
  useEffect(() => {
    if (pieces && form.baseUomId === null)
      setForm((current) => ({ ...current, baseUomId: pieces.id }));
  }, [pieces, form.baseUomId]);
  const onlyHome = homes.length === 1 ? homes[0] : undefined;
  useEffect(() => {
    if (onlyHome && form.homeWarehouseId === null) {
      setForm((current) => ({ ...current, homeWarehouseId: onlyHome.id }));
    }
  }, [onlyHome, form.homeWarehouseId]);
  // The category's suggestion fills the code (ADR-0044 #1); it may be typed over.
  useEffect(() => {
    const suggested = nextSku.data;
    if (suggested !== undefined) setForm((current) => ({ ...current, sku: suggested }));
  }, [nextSku.data]);

  const problems = problemsOf(form, units, picture);
  const messageOf = (field: FormProblemKey): string | null => {
    const found: FormProblem | undefined = checked ? problems[field] : undefined;
    return found ? t(`mobile.productNew.problems.${found}`) : null;
  };
  const busy = phase !== 'idle';
  const canRead = status.data?.read === true;

  /** One run: the photos go up, the model reads them, the server finishes the picture. */
  const run = async () => {
    const [first] = photos;
    if (busy || first === undefined) return;
    setProblem(null);
    setOutcome(null);
    setPhase('uploading');
    try {
      const fileIds: number[] = [];
      for (const uri of photos.slice(0, MAX_AI_PHOTOS)) fileIds.push(await ai.uploadPhoto(uri));
      const firstId = fileIds[0];
      if (firstId === undefined) return;

      let proposal: Proposal | null = null;
      let readProblem: AppProblem | null = null;
      if (canRead) {
        setPhase('reading');
        try {
          proposal = await ai.read(fileIds);
          const read = proposal;
          setForm((current) => withProposal(current, read, units));
        } catch (error) {
          readProblem = problemFrom(error);
        }
      }

      setPhase('picture');
      const made = await ai.image(
        proposal?.frontPhotoFileId ?? firstId,
        proposal?.productBox ?? null,
      );
      setPicture({
        imageFileId: made.imageFileId,
        thumbFileId: made.thumbFileId,
        uri: `data:image/jpeg;base64,${made.image}`,
        made: made.picture === 'made',
      });
      setOutcome({
        proposal,
        readProblem,
        pictureFailure: made.failure ? pictureFailureOf(made.failure) : null,
      });
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setPhase('idle');
    }
  };

  /** A scanned barcode: named when a product already carries it, added to its unit otherwise. */
  const onCode = async (code: string) => {
    const slot = scanning;
    setScanning(null);
    if (!slot) return;
    const added = withBarcode(form, slot, code);
    if (!added.ok) {
      toast.show({ message: t(`mobile.productNew.barcode.${added.reason}`) });
      return;
    }
    try {
      const found = await lookup(code);
      if (found) {
        toast.show({
          message: t('mobile.productNew.barcode.taken', {
            sku: found.product.sku,
            name: found.product.name,
          }),
          durationMs: 6_000,
        });
        return;
      }
    } catch {
      // Without an answer the code is taken as scanned; the save checks it again.
    }
    setForm((current) => {
      const again = withBarcode(current, slot, code);
      return again.ok ? again.form : current;
    });
  };

  const save = async () => {
    setChecked(true);
    setProblem(null);
    if (hasProblems(problems) || !picture) return;
    try {
      const product = await register.mutateAsync({ key, body: bodyOf(form, units, picture) });
      toast.show({
        message: t('mobile.productNew.saved', { sku: product.sku, name: product.name }),
      });
      // The next product keeps the category, the supplier, the home and the unit, as on the web.
      setForm(
        emptyForm({
          categoryId: form.categoryId,
          supplier: form.supplier,
          homeWarehouseId: form.homeWarehouseId,
          baseUomId: form.baseUomId,
        }),
      );
      setPhotos([]);
      setPicture(null);
      setOutcome(null);
      setChecked(false);
      setKey(Crypto.randomUUID());
      void nextSku.refetch();
    } catch (error) {
      const failure = problemFrom(error);
      // Another registrar took the code meanwhile: the next free one replaces it.
      if (failure.code === 'DUPLICATE_VALUE' && failure.params?.constraint === 'products_sku_key') {
        const fresh = await nextSku.refetch();
        if (fresh.data !== undefined) change({ sku: fresh.data });
        toast.show({ message: t('mobile.productNew.skuTaken') });
        return;
      }
      setProblem(failure);
    }
  };

  const category = categoryList.find((option) => option.id === form.categoryId);
  const home = homes.find((warehouse) => warehouse.id === form.homeWarehouseId);
  const filled = outcome?.proposal ? filledBy(outcome.proposal) : [];
  const loadProblem = uoms.error ?? categories.error ?? warehouses.error;

  const barcodes = (slot: BarcodeSlot, label: string) => (
    <View style={styles.codes}>
      <View style={styles.codesHead}>
        <Text style={type.label}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.productNew.barcode.scan', { unit: label })}
          onPress={() => setScanning(slot)}
          style={({ pressed }) => [styles.scan, pressed && styles.faded]}
        >
          <ScanLine size={18} strokeWidth={2} color={colors.primary} />
          <Text style={styles.scanText}>{t('mobile.productNew.barcode.add')}</Text>
        </Pressable>
      </View>
      {form[slot].length === 0 ? (
        <Text style={type.secondary}>{t('mobile.productNew.barcode.none')}</Text>
      ) : (
        <View style={styles.chips}>
          {form[slot].map((code) => (
            <View key={code} style={styles.chip}>
              <Text style={styles.chipText}>{code}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.productNew.barcode.remove', { code })}
                hitSlop={spacing.sm}
                onPress={() => setForm((current) => withoutBarcode(current, slot, code))}
              >
                <X size={16} strokeWidth={2.4} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.productNew.title')} onBack={() => router.back()} right={null} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <ProblemText
            problem={loadProblem ? problemFrom(loadProblem) : null}
            style={styles.flat}
          />

          <View style={styles.card}>
            <Text style={type.heading}>{t('mobile.productNew.photos.title')}</Text>
            <Text style={type.secondary}>{t('mobile.productNew.photos.hint')}</Text>
            {photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.strip}>
                  {photos.map((uri, index) => (
                    <View key={uri}>
                      <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.productNew.photos.remove', { n: index + 1 })}
                        disabled={busy}
                        hitSlop={spacing.xs}
                        onPress={() => setPhotos((list) => list.filter((one) => one !== uri))}
                        style={styles.thumbRemove}
                      >
                        <X size={14} strokeWidth={2.6} color={colors.foreground} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : null}
            <PillButton
              title={
                photos.length === 0
                  ? t('mobile.productNew.photos.take')
                  : t('mobile.productNew.photos.more')
              }
              variant={photos.length === 0 ? 'primary' : 'soft'}
              height={46}
              disabled={busy || photos.length >= MAX_AI_PHOTOS}
              icon={
                <Camera
                  size={20}
                  strokeWidth={2.2}
                  color={photos.length === 0 ? colors.primaryForeground : colors.primary}
                />
              }
              onPress={() => setShooting(true)}
            />
            {photos.length > 0 ? (
              <PillButton
                title={
                  canRead ? t('mobile.productNew.ai.button') : t('mobile.productNew.ai.pictureOnly')
                }
                height={46}
                loading={busy}
                loadingTitle={busy ? t(`mobile.productNew.ai.phase.${phase}`) : undefined}
                icon={<Sparkles size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
                onPress={() => void run()}
              />
            ) : null}
            {status.data && !status.data.read ? (
              <Text style={type.secondary}>{t('mobile.productNew.ai.readOff')}</Text>
            ) : null}
            {status.data?.read && !status.data.picture ? (
              <Text style={type.secondary}>{t('mobile.productNew.ai.pictureOff')}</Text>
            ) : null}
            <ProblemText
              problem={problem && phase === 'idle' && !checked ? problem : null}
              style={styles.flat}
            />
          </View>

          {outcome ? (
            <View style={styles.card}>
              {outcome.proposal ? (
                <View style={styles.note}>
                  <Text style={styles.noteText}>
                    {filled.length > 0
                      ? t('mobile.productNew.ai.filled', {
                          fields: filled
                            .map((field) => t(`mobile.productNew.ai.field.${field}`))
                            .join(', '),
                        })
                      : t('mobile.productNew.ai.nothing')}
                  </Text>
                  {outcome.proposal.note ? (
                    <Text style={type.secondary}>
                      {t('mobile.productNew.ai.note', { note: outcome.proposal.note })}
                    </Text>
                  ) : null}
                  {outcome.proposal.droppedBarcodes > 0 ? (
                    <Text style={type.secondary}>{t('mobile.productNew.ai.droppedBarcodes')}</Text>
                  ) : null}
                </View>
              ) : null}
              {outcome.proposal?.existing.map((entry) => (
                <View
                  key={`${entry.code}-${entry.productId}`}
                  accessibilityRole="alert"
                  style={styles.warn}
                >
                  <Text style={styles.warnText}>
                    {t('mobile.productNew.barcode.taken', { sku: entry.sku, name: entry.name })}
                  </Text>
                </View>
              ))}
              {outcome.readProblem ? (
                <>
                  <ProblemText problem={outcome.readProblem} style={styles.flat} />
                  <Text style={type.secondary}>{t('mobile.productNew.ai.byHand')}</Text>
                </>
              ) : null}
              {outcome.pictureFailure ? (
                <Text style={[type.body, styles.failure]}>
                  {t(`mobile.productNew.ai.pictureFailure.${outcome.pictureFailure}`)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {picture ? (
            <View style={styles.card}>
              <Text style={type.heading}>{t('mobile.productNew.picture.title')}</Text>
              <Image source={{ uri: picture.uri }} style={styles.picture} contentFit="contain" />
              <Text style={type.secondary}>
                {picture.made
                  ? t('mobile.productNew.picture.made')
                  : t('mobile.productNew.picture.original')}
              </Text>
            </View>
          ) : checked && problems.picture ? (
            <View accessibilityRole="alert" style={styles.warn}>
              <Text style={styles.warnText}>{t('mobile.productNew.problems.picture')}</Text>
            </View>
          ) : null}

          <SectionHeader>{t('mobile.productNew.sections.product')}</SectionHeader>
          <Group>
            <Row
              title={t('mobile.productNew.fields.category')}
              subtitle={messageOf('category')}
              value={category?.path ?? t('mobile.productNew.choose')}
              onPress={() => setPicking('category')}
            />
          </Group>
          <View style={styles.card}>
            <TextField
              label={t('mobile.productNew.fields.name')}
              value={form.name}
              onChangeText={(name) => change({ name })}
              error={messageOf('name')}
              autoCapitalize="sentences"
            />
            <TextField
              label={t('mobile.productNew.fields.sku')}
              value={form.sku}
              onChangeText={(sku) => change({ sku })}
              error={messageOf('sku')}
              hint={
                form.categoryId === null
                  ? t('mobile.productNew.fields.skuHint')
                  : nextSku.isFetching
                    ? t('mobile.productNew.fields.skuLoading')
                    : null
              }
              keyboardType="number-pad"
            />
          </View>

          <SectionHeader>{t('mobile.productNew.sections.units')}</SectionHeader>
          <View style={styles.card}>
            <Text style={type.label}>{t('mobile.productNew.fields.baseUnit')}</Text>
            <Segmented
              label={t('mobile.productNew.fields.baseUnit')}
              options={baseUnits.map((unit) => ({ value: String(unit.id), label: unit.name }))}
              value={form.baseUomId === null ? null : String(form.baseUomId)}
              onChange={(value) => change({ baseUomId: Number.parseInt(value, 10) })}
            />
            {messageOf('baseUnit') ? (
              <Text style={[type.secondary, styles.failure]}>{messageOf('baseUnit')}</Text>
            ) : null}
            <TextField
              label={t('mobile.productNew.fields.boxFactor')}
              value={form.boxFactor}
              onChangeText={(boxFactor) => change({ boxFactor })}
              error={messageOf('boxFactor')}
              keyboardType="decimal-pad"
            />
            <TextField
              label={t('mobile.productNew.fields.weight')}
              value={form.weightKg}
              onChangeText={(weightKg) => change({ weightKg })}
              error={messageOf('weight')}
              keyboardType="decimal-pad"
            />
            <TextField
              label={t('mobile.productNew.fields.blockFactor')}
              value={form.blockFactor}
              onChangeText={(blockFactor) => change({ blockFactor })}
              error={messageOf('blockFactor')}
              hint={t('mobile.productNew.fields.blockHint')}
              keyboardType="decimal-pad"
            />
          </View>

          <SectionHeader>{t('mobile.productNew.sections.barcodes')}</SectionHeader>
          <View style={styles.card}>
            {barcodes('baseBarcodes', t('mobile.productNew.fields.baseBarcodes'))}
            {barcodes('boxBarcodes', t('mobile.productNew.fields.boxBarcodes'))}
            {form.blockFactor.trim() !== ''
              ? barcodes('blockBarcodes', t('mobile.productNew.fields.blockBarcodes'))
              : null}
          </View>

          <SectionHeader>{t('mobile.productNew.sections.place')}</SectionHeader>
          <Group>
            <Row
              title={t('mobile.productNew.fields.supplier')}
              subtitle={messageOf('supplier')}
              value={form.supplier?.name ?? t('mobile.productNew.choose')}
              onPress={() => setPicking('supplier')}
            />
            <Row
              title={t('mobile.productNew.fields.warehouse')}
              subtitle={messageOf('warehouse')}
              value={home?.name ?? t('mobile.productNew.choose')}
              onPress={() => setPicking('warehouse')}
            />
          </Group>
        </ScrollView>
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <ProblemText problem={checked ? problem : null} style={styles.flat} />
          {checked && hasProblems(problems) ? (
            <Text style={[type.secondary, styles.failure]}>
              {t('mobile.productNew.incomplete')}
            </Text>
          ) : null}
          <PillButton
            title={t('common.save')}
            height={48}
            loading={register.isPending}
            disabled={busy || register.isPending}
            onPress={() => void save()}
          />
        </View>
      </KeyboardAvoidingView>

      <PhotoCamera
        visible={shooting}
        taken={photos}
        room={MAX_AI_PHOTOS - photos.length}
        onPhoto={(uri) => setPhotos((list) => [...list, uri].slice(0, MAX_AI_PHOTOS))}
        onClose={() => setShooting(false)}
      />
      <ScanSheet
        visible={scanning !== null}
        hint={t('mobile.productNew.barcode.scanHint')}
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(null)}
      />
      <PickSheet
        visible={picking === 'category'}
        title={t('mobile.productNew.fields.category')}
        searchLabel={t('mobile.productNew.search')}
        options={categoryList.map((option) => ({ id: option.id, title: option.path }))}
        selectedId={form.categoryId}
        loading={categories.isLoading}
        emptyText={t('mobile.productNew.empty')}
        onPick={(option) => {
          if (option.id !== form.categoryId) change({ categoryId: option.id, sku: '' });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <PickSheet
        visible={picking === 'supplier'}
        title={t('mobile.productNew.fields.supplier')}
        searchLabel={t('mobile.productNew.search')}
        options={(suppliers.data ?? []).map((supplier) => ({
          id: supplier.id,
          title: supplier.name,
          subtitle: supplier.code,
        }))}
        selectedId={form.supplier?.id ?? null}
        loading={suppliers.isLoading}
        problem={suppliers.error ? problemFrom(suppliers.error) : null}
        emptyText={t('mobile.productNew.empty')}
        onSearch={setSupplierText}
        onPick={(option) => {
          change({ supplier: { id: option.id, name: option.title } });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <PickSheet
        visible={picking === 'warehouse'}
        title={t('mobile.productNew.fields.warehouse')}
        searchLabel={t('mobile.productNew.search')}
        options={homes.map((warehouse) => ({ id: warehouse.id, title: warehouse.name }))}
        selectedId={form.homeWarehouseId}
        loading={warehouses.isLoading}
        emptyText={t('mobile.productNew.noWarehouse')}
        onPick={(option) => {
          change({ homeWarehouseId: option.id });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <ActionSheet
        visible={leaving.asking && navigation.isFocused()}
        title={t('mobile.productNew.leave.title')}
        message={t('mobile.productNew.leave.message')}
        actions={[
          {
            label: t('mobile.productNew.leave.confirm'),
            destructive: true,
            onPress: leaving.leave,
          },
        ]}
        cancelLabel={t('common.discard.keep')}
        onCancel={leaving.stay}
      />
    </Page>
  );
}

const THUMB = 76;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  faded: { opacity: 0.7 },
  flat: { marginTop: 0 },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  strip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingRight: spacing.xs,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: radii.control, backgroundColor: colors.fill },
  thumbRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.floatingFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.successSoft,
  },
  noteText: { ...type.body, color: colors.success },
  warn: {
    padding: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
  },
  warnText: { ...type.body, color: colors.warningText },
  failure: { color: colors.destructive },
  picture: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: radii.control,
    backgroundColor: colors.fill,
  },
  codes: { gap: spacing.sm },
  codesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scan: {
    height: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  scanText: { ...type.bodyStrong, color: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  chipText: { ...type.chip, color: colors.foreground },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
});
