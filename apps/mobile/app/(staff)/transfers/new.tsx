import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package, Plus, ScanLine } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import {
  useBarcodeLookup,
  useRequestTransfer,
  useSaveTransferRequestLines,
  useTransferRequest,
  useTransferRows,
  useUpdateTransferRequestNote,
} from '../../../src/api/transfers';
import { formatQty } from '../../../src/format/format';
import { useUnitWords } from '../../../src/shop/unit-words';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, fonts, radii, spacing, TOUCH, type } from '../../../src/theme/tokens';
import {
  changeOf,
  type DraftLine,
  draftLineOf,
  draftOfDetail,
  emptyDraft,
  setDraftLine,
  setDraftNote,
  type TransferDraft,
} from '../../../src/transfers/draft';
import { type HomeSection, sectionsByHome } from '../../../src/transfers/grouping';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { keypadUnitsOfRow, TransferKeypad } from '../../../src/transfers/transfer-keypad';
import type { TransferRequestRow, TransferRequestRowUnit } from '../../../src/transfers/types';
import { useStoredDraft } from '../../../src/transfers/use-draft';
import { useRequestSend } from '../../../src/transfers/use-request-send';
import { PillButton, SearchField } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text, TextInput } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const THUMB = 56;

/** The unit a product is requested by first: its largest pack, else the base unit. */
function requestUnitOf(units: readonly TransferRequestRowUnit[]): TransferRequestRowUnit | null {
  const packs = units.filter((unit) => !unit.isBase);
  const largest = [...packs].sort((a, b) =>
    new Decimal(b.factor).comparedTo(new Decimal(a.factor)),
  )[0];
  return largest ?? units.find((unit) => unit.isBase) ?? units[0] ?? null;
}

/**
 * The request editor (ADR-0116 #1–#3): the search and the camera, the products as cards grouped
 * by their home warehouse (the store's stock, the home's stock, last month's sales, the unit), a
 * tap opens the keypad. A new request (`?store=`) lives on the phone until «Илгээх», which creates
 * it (the idempotent send), asks the server to send it, and opens its page. An existing DRAFT
 * (`?id=`) is edited cell by cell with `PUT …/lines`; a change made meanwhile by someone else is
 * told and the rows refetched.
 */
export default function TransferRequestEditorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { server } = useSignedIn();
  const toast = useToast();
  const words = useUnitWords();
  const params = useLocalSearchParams<{ store?: string; id?: string }>();
  const requestId = params.id ? Number.parseInt(params.id, 10) : null;
  const editing = requestId !== null;

  // Editing: the server's DRAFT and what the screen opened with (per product, for the cell saves).
  const request = useTransferRequest(requestId);
  const storeId = editing
    ? (request.data?.destWarehouseId ?? null)
    : params.store
      ? Number.parseInt(params.store, 10)
      : null;
  const stored = useStoredDraft(editing ? null : storeId);
  const { setDraft: setStoredDraft } = stored;
  const [edited, setEdited] = useState<TransferDraft | null>(null);
  const opened = useRef(new Map<number, DraftLine>());
  useEffect(() => {
    if (!editing || !request.data || edited !== null) return;
    const draft = draftOfDetail(request.data);
    opened.current = new Map(draft.lines.map((line) => [line.productId, line]));
    setEdited(draft);
  }, [editing, request.data, edited]);

  const draft: TransferDraft = editing ? (edited ?? emptyDraft(storeId ?? 0)) : stored.draft;
  const ready = editing ? edited !== null : stored.ready;
  const setDraft = useCallback(
    (update: (current: TransferDraft) => TransferDraft) => {
      if (editing) setEdited((current) => (current ? update(current) : current));
      else setStoredDraft(update);
    },
    [editing, setStoredDraft],
  );

  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const rows = useTransferRows(
    storeId === null ? null : { warehouseId: storeId, q, ...(editing ? { requestId } : {}) },
  );
  const sections = useMemo(
    () => sectionsByHome((rows.data?.pages ?? []).flatMap((page) => page.data)),
    [rows.data],
  );
  const loadedRows = useMemo(() => sections.flatMap((section) => section.data), [sections]);

  const saveLines = useSaveTransferRequestLines();
  const updateNote = useUpdateTransferRequestNote();
  const requestTransfer = useRequestTransfer();
  const lookup = useBarcodeLookup();
  const sender = useRequestSend(draft, () => void stored.clear());

  const [keypad, setKeypad] = useState<{ row: TransferRequestRow; unitId: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const search = useRef<TextInput>(null);

  const openKeypad = useCallback(
    (row: TransferRequestRow, unitId?: number) => {
      if (row.homeWarehouseId === null) return;
      const line = draftLineOf(draft, row.productId);
      const unit = unitId ?? line?.productUnitId ?? requestUnitOf(row.units)?.id;
      if (unit === undefined) return;
      setKeypad({ row, unitId: unit });
    },
    [draft],
  );

  /** A new quantity for a product: into the phone's draft, or saved as one cell of the DRAFT. */
  const applyLine = async (row: TransferRequestRow, unitId: number, qty: string) => {
    setKeypad(null);
    if (!editing || requestId === null) {
      setDraft((current) => setDraftLine(current, row.productId, unitId, qty));
      return;
    }
    const before = opened.current.get(row.productId);
    try {
      const result = await saveLines.mutateAsync({
        id: requestId,
        changes: [changeOf(before, row.productId, unitId, qty)],
      });
      if (result.conflicts.length > 0) {
        toast.show({ message: t('mobile.transfers.new.conflict') });
        setEdited(null);
        await request.refetch();
        await rows.refetch();
        return;
      }
      if (result.refused.length > 0) {
        toast.show({ message: t('mobile.transfers.new.refusedNoHome') });
        return;
      }
      const next = setDraftLine(draft, row.productId, unitId, qty);
      const line = draftLineOf(next, row.productId);
      if (line) opened.current.set(row.productId, line);
      else opened.current.delete(row.productId);
      setEdited(next);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const onCode = async (code: string) => {
    setScanning(false);
    try {
      const found = await lookup(code);
      if (!found) {
        toast.show({ message: t('mobile.transfers.receive.unknownBarcode') });
        return;
      }
      const row = loadedRows.find((entry) => entry.productId === found.product.id);
      if (row) {
        if (row.homeWarehouseId === null) {
          toast.show({ message: t('mobile.transfers.new.noHome') });
          return;
        }
        openKeypad(
          row,
          row.units.some((unit) => unit.id === found.unit.id) ? found.unit.id : undefined,
        );
        return;
      }
      // Not among the loaded rows: the search finds it, the seller taps it.
      setText(found.product.sku);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  /** A new request: created with its key, then sent; its page opens either way. */
  const send = async () => {
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      if (editing && requestId !== null) {
        await requestTransfer.mutateAsync(requestId);
        toast.show({ message: t('mobile.transfers.new.sent') });
        router.replace(`/transfers/${requestId}`);
        return;
      }
      const result = sender.pending ? await sender.resend() : await sender.send();
      if (!result || result.kind === 'unknown') return;
      if (result.kind === 'refused') {
        setProblem(result.problem);
        return;
      }
      const created = result.order;
      try {
        await requestTransfer.mutateAsync(created.id);
        toast.show({ message: t('mobile.transfers.new.sent') });
      } catch {
        toast.show({ message: t('mobile.transfers.new.savedDraft'), durationMs: 6_000 });
      }
      router.replace(`/transfers/${created.id}`);
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setSending(false);
    }
  };

  const onNoteBlur = () => {
    if (!editing || requestId === null || !request.data) return;
    const note = draft.note.trim() || null;
    if (note === (request.data.note ?? null)) return;
    updateNote.mutate({ id: requestId, note });
  };

  const renderRow = ({ item }: { item: TransferRequestRow }) => {
    const line = draftLineOf(draft, item.productId);
    const unit = line
      ? (item.units.find((entry) => entry.id === line.productUnitId) ?? null)
      : requestUnitOf(item.units);
    const base = item.units.find((entry) => entry.isBase) ?? item.units[0];
    const homeless = item.homeWarehouseId === null;
    const unitWord = unit ? words({ uomCode: unit.uomCode, uomName: unit.name }) : null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          line
            ? t('mobile.transfers.new.change', { name: item.name })
            : t('mobile.transfers.new.add', { name: item.name })
        }
        accessibilityState={{ disabled: homeless }}
        disabled={homeless}
        onPress={() => openKeypad(item)}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, homeless && styles.dim]}
      >
        <View style={styles.thumb}>
          {item.thumbUrl ? (
            <Image
              source={{ uri: `${server}${item.thumbUrl}` }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={item.thumbUrl}
            />
          ) : (
            <Package size={24} strokeWidth={1.5} color={colors.input} />
          )}
        </View>
        <View style={styles.grow}>
          <Text style={type.row} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={type.secondary} numberOfLines={1}>
            {homeless
              ? `${item.sku} · ${t('mobile.transfers.new.noHome')}`
              : t('mobile.transfers.new.stockLine', {
                  store: formatQty(item.storeOnHand),
                  home: formatQty(item.homeOnHand),
                  out: formatQty(item.lastMonthOut),
                  unit: base ? words({ uomCode: base.uomCode, uomName: base.name }).short : '',
                })}
          </Text>
          {unitWord && !homeless ? (
            <View style={styles.unitPill}>
              <Text style={styles.unitText} numberOfLines={1}>
                {unitWord.title}
              </Text>
            </View>
          ) : null}
        </View>
        {homeless ? null : line && unitWord ? (
          <View style={styles.qty}>
            <Text style={styles.qtyText} numberOfLines={1}>
              {`${formatQty(line.qty)} ${unitWord.short}`}
            </Text>
          </View>
        ) : (
          <View style={styles.plus}>
            <Plus size={20} strokeWidth={2.4} color={colors.primary} />
          </View>
        )}
      </Pressable>
    );
  };

  const count = draft.lines.length;
  const keypadBase = keypad?.row.units.find((unit) => unit.isBase) ?? keypad?.row.units[0];

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t(editing ? 'mobile.transfers.new.editTitle' : 'mobile.transfers.new.title')}
        onBack={() => router.back()}
        right={null}
      >
        <View style={styles.searchRow}>
          <SearchField
            inputRef={search}
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.transfers.new.search')}
            accessibilityLabel={t('mobile.shop.searchLabel')}
            style={styles.search}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.transfers.new.scan')}
            onPress={() => setScanning(true)}
            style={({ pressed }) => [styles.scanButton, pressed && styles.faded]}
          >
            <ScanLine size={22} strokeWidth={1.9} color={colors.primary} />
          </Pressable>
        </View>
      </StoreHeader>

      {sender.pending && !editing ? (
        <View style={styles.pendingCard}>
          <Text style={type.rowStrong}>{t('mobile.transfers.new.pendingTitle')}</Text>
          <Text style={type.secondary}>{t('mobile.transfers.new.pendingHint')}</Text>
          <View style={styles.pendingActions}>
            <PillButton
              title={t('mobile.transfers.new.resend')}
              height={40}
              loading={sending}
              onPress={() => void send()}
            />
            <PillButton
              title={t('mobile.transfers.new.forget')}
              variant="destructive"
              height={40}
              onPress={() => setForgetting(true)}
            />
          </View>
        </View>
      ) : null}

      <SectionList<TransferRequestRow, HomeSection<TransferRequestRow>>
        sections={sections}
        keyExtractor={(row) => String(row.productId)}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 150 },
        ]}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
            {section.homeWarehouseName ?? t('mobile.transfers.new.noHomeSection')}
          </Text>
        )}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (rows.hasNextPage && !rows.isFetchingNextPage) void rows.fetchNextPage();
        }}
        refreshing={rows.isRefetching && !rows.isFetchingNextPage}
        onRefresh={() => void rows.refetch()}
        ListEmptyComponent={
          rows.isLoading || !ready || storeId === null ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : rows.error ? (
            <ProblemText problem={problemFrom(rows.error)} style={styles.problem} />
          ) : (
            <EmptyState
              icon={<Package size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.transfers.new.empty')}
              hint={t('mobile.transfers.new.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          rows.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {problem ? <ProblemText problem={problem} style={styles.footerProblem} /> : null}
        <TextInput
          value={draft.note}
          onChangeText={(note) => setDraft((current) => setDraftNote(current, note))}
          onBlur={onNoteBlur}
          placeholder={t('mobile.transfers.new.notePlaceholder')}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={t('mobile.transfers.new.note')}
          maxLength={500}
          style={[type.field, styles.note]}
        />
        <PillButton
          title={
            count > 0
              ? t('mobile.transfers.new.send', { n: count })
              : t('mobile.transfers.new.sendEmpty')
          }
          disabled={count === 0 || !ready || (sender.pending !== null && !editing)}
          loading={sending}
          onPress={() => void send()}
        />
      </View>

      {keypad && keypadBase ? (
        <TransferKeypad
          visible
          target={{
            name: keypad.row.name,
            sku: keypad.row.sku,
            thumbUrl: keypad.row.thumbUrl,
            units: keypadUnitsOfRow(keypad.row.units),
          }}
          server={server}
          unitId={keypad.unitId}
          qty={draftLineOf(draft, keypad.row.productId)?.qty ?? ''}
          subtitle={t('mobile.transfers.new.keypadStock', {
            sku: keypad.row.sku,
            n: formatQty(keypad.row.homeOnHand),
            unit: words({ uomCode: keypadBase.uomCode, uomName: keypadBase.name }).name,
          })}
          onDone={(unitId, qty) => void applyLine(keypad.row, unitId, qty)}
          onCancel={() => setKeypad(null)}
        />
      ) : null}
      <ScanSheet
        visible={scanning}
        hint={t('mobile.transfers.new.scanHint')}
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(false)}
      />
      <ActionSheet
        visible={forgetting}
        title={t('mobile.transfers.new.forgetTitle')}
        message={t('mobile.transfers.new.forgetHint')}
        actions={[
          {
            label: t('mobile.transfers.new.forget'),
            destructive: true,
            onPress: () => {
              setForgetting(false);
              void sender.forget();
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setForgetting(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 3 },
  faded: { opacity: 0.7 },
  pressed: { backgroundColor: colors.accent },
  dim: { opacity: 0.5 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingBottom: spacing.md,
  },
  search: { flex: 1, backgroundColor: colors.card },
  scanButton: {
    width: TOUCH,
    height: 40,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCard: {
    marginHorizontal: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.warningSoft,
  },
  pendingActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  list: { paddingHorizontal: 14 },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.control,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  unitPill: {
    alignSelf: 'flex-start',
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.canvas,
    justifyContent: 'center',
  },
  unitText: { ...type.caption, fontFamily: fonts.semibold, color: colors.label2 },
  qty: {
    minWidth: TOUCH,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: { ...type.chip, fontFamily: fonts.semibold, color: colors.primaryForeground },
  plus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: { height: spacing.sm },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: spacing.md },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    backgroundColor: colors.sheetBarFill,
  },
  footerProblem: { marginTop: 0 },
  note: {
    height: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    color: colors.foreground,
  },
});
