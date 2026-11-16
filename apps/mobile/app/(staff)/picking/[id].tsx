import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Minus, PackageOpen, ScanLine, X } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useConfirmPart, usePickInfo, usePickOrder, useTakePart } from '../../../src/api/picking';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useBarcodeLookup } from '../../../src/api/transfers';
import { shortDate } from '../../../src/dates/dates';
import { formatQty } from '../../../src/format/format';
import { LineCountBadge, ShelfPill } from '../../../src/picking/pills';
import {
  BASE_UNIT_ID,
  binOf,
  confirmBody,
  type Counts,
  keypadUnitsOfPickLine,
  lineCountState,
  toBaseQty,
} from '../../../src/picking/sections';
import type { PickLine } from '../../../src/picking/types';
import { isPickLead } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { TransferKeypad } from '../../../src/transfers/transfer-keypad';
import type { BarcodeResolution } from '../../../src/transfers/types';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { Card, FooterBar, ProgressBar } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const DASH = '—';

/** The keypad is open for a line; the scanned unit (any of the product's) is preselected. */
interface KeypadFor {
  line: PickLine;
  scanned: BarcodeResolution['unit'] | null;
}

/**
 * One warehouse's part of an order (ADR-0126 #2 on the phone, ADR-0132): the order's number as the
 * header's title over the customer and the delivery date, a progress card (who picks, the counted
 * lines, the warehouse and the note), then the warehouse's lines with a round mark, what was
 * ordered, the count's pill, the shelf's pill and the picked number. An OPEN
 * part is taken with «Бэлдэж эхлэх»; the picker (a lead on any part) counts by scanning — the read
 * code lands on the product's line and opens the keypad in the scanned unit, «Дууссан» = 0 — or
 * by tapping a row, changes the shelf when the line has several, and confirms every line at once:
 * an uncounted line goes at its reserved count. The counts stay on the phone by line while the
 * order re-reads every 15 s; the confirmation is one idempotent request.
 */
export default function PickingPartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { me, server } = useSignedIn();
  const { id, warehouse } = useLocalSearchParams<{ id: string; warehouse: string }>();
  const orderId = Number.parseInt(id ?? '0', 10);
  const warehouseId = Number.parseInt(warehouse ?? '0', 10);
  const order = usePickOrder(orderId);
  const part = order.data?.picks.find((entry) => entry.warehouseId === warehouseId) ?? null;
  const lead = isPickLead(me);
  const mine = part?.status === 'PICKING' && part.pickerId === me.id;
  const canConfirm = part?.status === 'PICKING' && (mine || lead);
  const canTake = part?.status === 'OPEN';
  const info = usePickInfo(canConfirm ? orderId : null);
  const take = useTakePart();
  const confirm = useConfirmPart();
  const lookup = useBarcodeLookup();
  const list = useRef<FlatList<PickLine>>(null);

  const [counts, setCounts] = useState<Counts>({});
  const [bins, setBins] = useState<Record<number, number>>({});
  const [keypad, setKeypad] = useState<KeypadFor | null>(null);
  const [choosingBin, setChoosingBin] = useState<PickLine | null>(null);
  const [scanning, setScanning] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [key, setKey] = useState(() => Crypto.randomUUID());

  const lines = useMemo(
    () => (order.data?.lines ?? []).filter((line) => line.warehouseId === warehouseId),
    [order.data, warehouseId],
  );
  const infoOf = (lineId: number) => info.data?.find((entry) => entry.lineId === lineId);
  const body = confirmBody(lines, counts, info.data ?? [], bins);

  const onCode = async (code: string) => {
    setScanning(false);
    setProblem(null);
    try {
      const found = await lookup(code);
      if (!found) {
        toast.show({ message: t('mobile.picking.part.unknownBarcode') });
        return;
      }
      const line = lines.find((entry) => entry.productId === found.product.id);
      if (!line) {
        toast.show({ message: t('mobile.picking.part.notInPart', { name: found.product.name }) });
        return;
      }
      setHighlighted(line.id);
      const index = lines.findIndex((entry) => entry.id === line.id);
      if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
      setKeypad({ line, scanned: found.unit });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const takePart = async () => {
    setProblem(null);
    try {
      await take.mutateAsync({ orderId, warehouseId });
      toast.show({ message: t('mobile.picking.part.taken') });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const confirmPart = async () => {
    setProblem(null);
    try {
      await confirm.mutateAsync({ orderId, warehouseId, key, lines: body.lines });
      setKey(Crypto.randomUUID());
      toast.show({ message: t('mobile.picking.part.confirmed') });
      router.back();
    } catch (error) {
      // The request reached the server (or may have): the next attempt is a new one.
      setKey(Crypto.randomUUID());
      setProblem(problemFrom(error));
    }
  };

  const opened = keypad
    ? {
        units: keypadUnitsOfPickLine(keypad.line, keypad.scanned),
        unitId: keypad.scanned && !keypad.scanned.isBase ? keypad.scanned.id : BASE_UNIT_ID,
        qty: counts[keypad.line.id] ?? '',
      }
    : null;

  const renderLine = ({ item, index }: { item: PickLine; index: number }) => {
    const state = lineCountState(item, counts);
    const lineInfo = infoOf(item.id);
    const binId = binOf(lineInfo, bins[item.id]);
    const bin = lineInfo?.bins.find((entry) => entry.id === binId);
    const reservedShort = item.qtyApproved !== item.qtyBase;
    const picked = counts[item.id] ?? item.qtyPicked;
    return (
      <View
        style={[
          styles.cell,
          index === 0 && styles.firstCell,
          index === lines.length - 1 && styles.lastCell,
        ]}
      >
        {index > 0 ? <Separator /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.picking.part.countLine', { name: item.productName })}
          disabled={!canConfirm}
          onPress={() => setKeypad({ line: item, scanned: null })}
          style={({ pressed }) => [
            styles.line,
            state.kind === 'short' && styles.lineShort,
            state.kind === 'out' && styles.lineOut,
            highlighted === item.id && styles.highlighted,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.mark, MARKS[state.kind]]}>
            {state.kind === 'full' ? (
              <Check size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : state.kind === 'short' ? (
              <Minus size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : state.kind === 'out' ? (
              <X size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : null}
          </View>
          <View style={styles.grow}>
            <Text style={type.rowStrong} numberOfLines={2}>
              {item.productName}
            </Text>
            <Text style={type.secondary} numberOfLines={2}>
              {[
                item.productSku,
                t('mobile.picking.part.ordered', {
                  qty: formatQty(item.qtyBase),
                  unit: item.baseUnitName,
                }),
                reservedShort
                  ? t('mobile.picking.part.reserved', {
                      qty: formatQty(item.qtyApproved),
                      unit: item.baseUnitName,
                    })
                  : null,
              ]
                .filter((entry): entry is string => entry !== null)
                .join(' · ')}
            </Text>
            <View style={styles.badges}>
              <LineCountBadge state={state} baseUnit={item.baseUnitName} />
              {canConfirm && lineInfo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.picking.part.chooseShelf')}
                  disabled={lineInfo.bins.length < 2}
                  onPress={() => setChoosingBin(item)}
                  hitSlop={10}
                >
                  <ShelfPill
                    label={bin ? bin.code : t('mobile.picking.part.noShelf')}
                    none={!bin}
                  />
                </Pressable>
              ) : item.pickBinCode ? (
                <ShelfPill label={item.pickBinCode} />
              ) : null}
            </View>
          </View>
          <Text
            accessibilityLabel={
              picked !== null && picked !== undefined
                ? t('mobile.picking.part.counted', {
                    qty: formatQty(picked),
                    unit: item.baseUnitName,
                  })
                : t('mobile.picking.part.states.uncounted')
            }
            style={[
              styles.picked,
              state.kind === 'short' && { color: colors.warning },
              state.kind === 'out' && { color: colors.destructive },
              state.kind === 'uncounted' && { color: colors.muted },
            ]}
          >
            {picked !== null && picked !== undefined ? formatQty(picked) : DASH}
          </Text>
        </Pressable>
      </View>
    );
  };

  const detail = order.data;
  const title = detail
    ? (detail.number ?? t('mobile.picking.draftNo', { id: detail.id }))
    : t('mobile.picking.part.title');
  const countedLines = lines.filter(
    (line) => lineCountState(line, counts).kind !== 'uncounted',
  ).length;

  return (
    <Page edges={[]}>
      <StoreHeader
        title={title}
        subtitle={
          detail
            ? [
                detail.customerName,
                t('mobile.picking.deliver', { date: shortDate(detail.deliveryDate) }),
              ].join(' · ')
            : null
        }
        onBack={() => router.back()}
        right={
          part ? (
            <View style={styles.headerPill}>
              <Text style={styles.headerPillText} numberOfLines={1}>
                {t(`mobile.picking.status.${part.status}`)}
              </Text>
            </View>
          ) : null
        }
      />
      {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
      <FlatList<PickLine>
        ref={list}
        style={styles.fill}
        data={lines}
        keyExtractor={(line) => String(line.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          detail && part ? (
            <Card style={styles.summary}>
              <View style={styles.rowTop}>
                <Text style={[type.rowStrong, styles.grow]} numberOfLines={2}>
                  {part.pickerName
                    ? part.status === 'DONE'
                      ? t('mobile.picking.part.done', { name: part.pickerName })
                      : mine
                        ? t('mobile.picking.part.mine')
                        : t('mobile.picking.part.byOther', { name: part.pickerName })
                    : t(`mobile.picking.status.${part.status}`)}
                </Text>
                <Text style={[type.rowStrong, tabular, styles.link]}>
                  {t('mobile.picking.part.progress', { done: countedLines, total: lines.length })}
                </Text>
              </View>
              <ProgressBar value={lines.length > 0 ? countedLines / lines.length : 0} />
              <Text style={type.secondary} numberOfLines={4}>
                {[
                  part.warehouseName,
                  detail.note ? t('mobile.picking.part.note', { note: detail.note }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Card>
          ) : null
        }
        ListFooterComponent={
          canConfirm && body.uncounted > 0 ? (
            <Text style={[type.secondary, styles.hint]}>
              {t('mobile.picking.part.uncountedNote', { n: body.uncounted })}
            </Text>
          ) : null
        }
        renderItem={renderLine}
        onScrollToIndexFailed={() => undefined}
        refreshing={order.isRefetching}
        onRefresh={() => void order.refetch()}
        ListEmptyComponent={
          order.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : order.error ? (
            <ProblemText problem={problemFrom(order.error)} />
          ) : (
            <EmptyState
              icon={<PackageOpen size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.picking.part.noLines')}
            />
          )
        }
      />
      {canTake ? (
        <FooterBar>
          <PillButton
            title={t('mobile.picking.part.take')}
            style={styles.button}
            loading={take.isPending}
            onPress={() => void takePart()}
          />
        </FooterBar>
      ) : null}
      {canConfirm ? (
        <FooterBar column>
          {info.data && body.missingBins > 0 ? (
            <Text style={[type.secondary, styles.center, styles.warning]}>
              {t('mobile.picking.part.missingShelves', { n: body.missingBins })}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <PillButton
              title={t('mobile.picking.part.scan')}
              variant="soft"
              icon={<ScanLine size={20} strokeWidth={2} color={colors.link} />}
              style={styles.button}
              onPress={() => setScanning(true)}
            />
            <PillButton
              title={t('mobile.picking.part.confirm')}
              icon={<Check size={20} strokeWidth={2.4} color={colors.primaryForeground} />}
              style={styles.button}
              disabled={!info.data || body.missingBins > 0 || lines.length === 0}
              loading={confirm.isPending}
              onPress={() => void confirmPart()}
            />
          </View>
        </FooterBar>
      ) : null}

      {keypad && opened ? (
        <TransferKeypad
          visible
          target={{
            name: keypad.line.productName,
            sku: keypad.line.productSku,
            thumbUrl: null,
            units: opened.units,
          }}
          server={server}
          unitId={opened.unitId}
          qty={opened.qty && opened.unitId !== BASE_UNIT_ID ? '' : opened.qty}
          subtitle={(unit) =>
            unit.isBase
              ? t('mobile.picking.part.ordered', {
                  qty: formatQty(keypad.line.qtyBase),
                  unit: keypad.line.baseUnitName,
                })
              : t('mobile.picking.part.orderedIn', {
                  qty: formatQty(keypad.line.qtyBase),
                  base: keypad.line.baseUnitName,
                  unit: unit.uomName,
                })
          }
          extra={{
            label: t('mobile.picking.part.outOfStock'),
            onPress: () => {
              setCounts((current) => ({ ...current, [keypad.line.id]: '0' }));
              setKeypad(null);
            },
          }}
          onDone={(unitId, qty) => {
            setCounts((current) => ({
              ...current,
              [keypad.line.id]: toBaseQty(qty, unitId, opened.units),
            }));
            setKeypad(null);
          }}
          onCancel={() => setKeypad(null)}
        />
      ) : null}
      <ScanSheet
        visible={scanning}
        hint={t('mobile.picking.part.scanHint')}
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(false)}
      />
      <ActionSheet
        visible={choosingBin !== null}
        title={t('mobile.picking.part.chooseShelf')}
        message={choosingBin?.productName ?? ''}
        actions={(choosingBin ? (infoOf(choosingBin.id)?.bins ?? []) : []).map((bin) => ({
          label: t('mobile.picking.part.shelfOption', {
            code: bin.code,
            onHand: formatQty(bin.onHand),
            unit: choosingBin?.baseUnitName ?? '',
          }),
          onPress: () => {
            if (choosingBin) setBins((current) => ({ ...current, [choosingBin.id]: bin.id }));
            setChoosingBin(null);
          },
        }))}
        cancelLabel={t('common.cancel')}
        onCancel={() => setChoosingBin(null)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  center: { textAlign: 'center' },
  warning: { color: colors.warning, fontFamily: fonts.medium },
  link: { color: colors.link },
  pressed: { backgroundColor: colors.accent },
  highlighted: { backgroundColor: colors.secondary },
  problem: { marginHorizontal: spacing.lg },
  headerPill: {
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginRight: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
  },
  headerPillText: {
    ...type.secondary,
    fontFamily: fonts.semibold,
    color: colors.primaryForeground,
  },
  list: { padding: spacing.lg, flexGrow: 1 },
  summary: { gap: spacing.sm, marginBottom: spacing.md, paddingVertical: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hint: { paddingHorizontal: spacing.xs, paddingTop: spacing.md },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lineShort: { backgroundColor: colors.warningSoft },
  lineOut: { backgroundColor: colors.destructiveSoft },
  mark: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  picked: { ...type.title3, ...tabular, minWidth: 28, textAlign: 'right' },
  loading: { marginTop: spacing.xl },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});

/** The round mark before a line: green when full, orange when short, red when out, else a ring. */
const MARKS = StyleSheet.create({
  uncounted: { borderWidth: 2, borderColor: colors.fieldBorder },
  full: { backgroundColor: colors.tint.green },
  short: { backgroundColor: colors.tint.orange },
  out: { backgroundColor: colors.tint.red },
});
