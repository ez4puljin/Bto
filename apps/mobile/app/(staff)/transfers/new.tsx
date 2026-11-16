import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package, Plus, Send, StickyNote } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
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
import { colors, fonts, radii, spacing, tabular, TOUCH, type } from '../../../src/theme/tokens';
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
import { HeaderSearch } from '../../../src/transfers/header-search';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { keypadUnitsOfRow, TransferKeypad } from '../../../src/transfers/transfer-keypad';
import type { TransferRequestRow, TransferRequestRowUnit } from '../../../src/transfers/types';
import { useStoredDraft } from '../../../src/transfers/use-draft';
import { useRequestSend } from '../../../src/transfers/use-request-send';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { FooterBar, Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text, TextInput } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const THUMB = 52;

/** The unit a product is requested by first: its largest pack, else the base unit. */
function requestUnitOf(units: readonly TransferRequestRowUnit[]): TransferRequestRowUnit | null {
  const packs = units.filter((unit) => !unit.isBase);
  const largest = [...packs].sort((a, b) =>
    new Decimal(b.factor).comparedTo(new Decimal(a.factor)),
  )[0];
  return largest ?? units.find((unit) => unit.isBase) ?? units[0] ?? null;
}

/**
 * The request editor (ADR-0116 #1–#3): the header's search field with the camera inside it, the
 * products in one grouped list per home warehouse (the store's stock, the home's stock, last month's sales, the unit), a
 * tap opens the keypad. A new request (`?store=`) lives on the phone until «Илгээх», which creates
 * it (the idempotent send), asks the server to send it, and opens its page. An existing DRAFT
 * (`?id=`) is edited cell by cell with `PUT …/lines`; a change made meanwhile by someone else is
 * told and the rows refetched.
 */
export default function TransferRequestEditorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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

  const renderRow = ({
    item,
    index,
    section,
  }: {
    item: TransferRequestRow;
    index: number;
    section: HomeSection<TransferRequestRow>;
  }) => {
    const line = draftLineOf(draft, item.productId);
    const unit = line
      ? (item.units.find((entry) => entry.id === line.productUnitId) ?? null)
      : requestUnitOf(item.units);
    const base = item.units.find((entry) => entry.isBase) ?? item.units[0];
    const homeless = item.homeWarehouseId === null;
    const unitWord = unit ? words({ uomCode: unit.uomCode, uomName: unit.name }) : null;
    const storeOut = !homeless && new Decimal(item.storeOnHand).lte(0);
    return (
      <View
        style={[
          styles.cell,
          index === 0 && styles.firstCell,
          index === section.data.length - 1 && styles.lastCell,
          homeless && styles.dim,
        ]}
      >
        {index > 0 ? <Separator /> : null}
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
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
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
            <Text style={type.rowStrong} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[type.secondary, tabular]} numberOfLines={2}>
              {homeless
                ? `${item.sku} · ${t('mobile.transfers.new.noHome')}`
                : t('mobile.transfers.new.stockLine', {
                    store: formatQty(item.storeOnHand),
                    home: formatQty(item.homeOnHand),
                    out: formatQty(item.lastMonthOut),
                    unit: base ? words({ uomCode: base.uomCode, uomName: base.name }).short : '',
                  })}
            </Text>
            {!homeless && (unitWord || storeOut) ? (
              <View style={styles.pills}>
                {unitWord ? <Pill label={unitWord.title} /> : null}
                {storeOut ? <Pill label={t('mobile.transfers.new.storeOut')} tone="bad" /> : null}
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
              <Plus size={20} strokeWidth={2.4} color={colors.link} />
            </View>
          )}
        </Pressable>
      </View>
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
        <HeaderSearch
          inputRef={search}
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.transfers.new.search')}
          accessibilityLabel={t('mobile.shop.searchLabel')}
          onScan={() => setScanning(true)}
          scanLabel={t('mobile.transfers.new.scan')}
        />
      </StoreHeader>

      {sender.pending && !editing ? (
        <View style={styles.pendingCard}>
          <Text style={type.rowStrong}>{t('mobile.transfers.new.pendingTitle')}</Text>
          <Text style={type.secondary}>{t('mobile.transfers.new.pendingHint')}</Text>
          <View style={styles.pendingActions}>
            <PillButton
              title={t('mobile.transfers.new.resend')}
              height={44}
              loading={sending}
              onPress={() => void send()}
            />
            <PillButton
              title={t('mobile.transfers.new.forget')}
              variant="destructive"
              height={44}
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
        style={styles.fill}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <SectionHeader style={styles.sectionHeader}>
            {section.homeWarehouseName ?? t('mobile.transfers.new.noHomeSection')}
          </SectionHeader>
        )}
        renderItem={renderRow}
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

      <FooterBar column style={styles.footer}>
        {problem ? <ProblemText problem={problem} style={styles.footerProblem} /> : null}
        <View style={styles.note}>
          <StickyNote size={18} strokeWidth={2} color={colors.muted} />
          <TextInput
            value={draft.note}
            onChangeText={(note) => setDraft((current) => setDraftNote(current, note))}
            onBlur={onNoteBlur}
            placeholder={t('mobile.transfers.new.notePlaceholder')}
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={t('mobile.transfers.new.note')}
            maxLength={500}
            style={[type.row, styles.noteInput]}
          />
        </View>
        <PillButton
          title={
            count > 0
              ? t('mobile.transfers.new.send', { n: count })
              : t('mobile.transfers.new.sendEmpty')
          }
          icon={<Send size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
          disabled={count === 0 || !ready || (sender.pending !== null && !editing)}
          loading={sending}
          onPress={() => void send()}
        />
      </FooterBar>

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
  fill: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  pressed: { backgroundColor: colors.accent },
  dim: { opacity: 0.55 },
  pendingCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.warningSoft,
  },
  pendingActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  sectionHeader: { marginTop: spacing.lg },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  qty: {
    minWidth: TOUCH,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    ...type.chip,
    ...tabular,
    fontFamily: fonts.semibold,
    color: colors.primaryForeground,
  },
  plus: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: spacing.md },
  footer: { gap: 10 },
  footerProblem: { marginTop: 0 },
  note: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.card,
  },
  noteInput: { flex: 1, height: 44, paddingVertical: 0 },
});
