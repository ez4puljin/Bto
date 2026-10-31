import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PackageOpen, ScanLine } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConfirmPart, usePickInfo, usePickOrder, useTakePart } from '../../../src/api/picking';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { useBarcodeLookup } from '../../../src/api/transfers';
import { shortDate } from '../../../src/dates/dates';
import { formatQty } from '../../../src/format/format';
import { LineCountBadge, PickStatusPill } from '../../../src/picking/pills';
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
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { ScanSheet } from '../../../src/transfers/scan-sheet';
import { TransferKeypad } from '../../../src/transfers/transfer-keypad';
import type { BarcodeResolution } from '../../../src/transfers/types';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** The keypad is open for a line; the scanned unit (any of the product's) is preselected. */
interface KeypadFor {
  line: PickLine;
  scanned: BarcodeResolution['unit'] | null;
}

/**
 * One warehouse's part of an order (ADR-0126 #2 on the phone, ADR-0132): the order's facts and
 * the part's pill, then the warehouse's lines with what was ordered and the count's badge. An OPEN
 * part is taken with «Бэлдэж эхлэх»; the picker (a lead on any part) counts by scanning — the read
 * code lands on the product's line and opens the keypad in the scanned unit, «Дууссан» = 0 — or
 * by tapping a row, changes the shelf when the line has several, and confirms every line at once:
 * an uncounted line goes at its reserved count. The counts stay on the phone by line while the
 * order re-reads every 15 s; the confirmation is one idempotent request.
 */
export default function PickingPartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
            pressed && styles.pressed,
            highlighted === item.id && styles.highlighted,
          ]}
        >
          <View style={styles.grow}>
            <Text style={type.row} numberOfLines={2}>
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
                state.kind !== 'uncounted' && counts[item.id] !== undefined
                  ? t('mobile.picking.part.counted', {
                      qty: formatQty(counts[item.id] ?? '0'),
                      unit: item.baseUnitName,
                    })
                  : item.qtyPicked !== null && counts[item.id] === undefined
                    ? t('mobile.picking.part.counted', {
                        qty: formatQty(item.qtyPicked),
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
                  hitSlop={6}
                >
                  <Text style={[type.caption, lineInfo.bins.length > 1 && styles.link]}>
                    {bin
                      ? t('mobile.picking.part.shelf', { code: bin.code })
                      : t('mobile.picking.part.noShelf')}
                  </Text>
                </Pressable>
              ) : item.pickBinCode ? (
                <Text style={type.caption}>
                  {t('mobile.picking.part.shelf', { code: item.pickBinCode })}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  const detail = order.data;
  const title = detail
    ? (detail.number ?? t('mobile.picking.draftNo', { id: detail.id }))
    : t('mobile.picking.part.title');
  const footerPadding = Math.max(insets.bottom, spacing.md);

  return (
    <Page edges={[]}>
      <StoreHeader title={title} onBack={() => router.back()} right={null} />
      {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
      <FlatList<PickLine>
        ref={list}
        data={lines}
        keyExtractor={(line) => String(line.id)}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: footerPadding + (canTake || canConfirm ? 140 : 0) },
        ]}
        ListHeaderComponent={
          detail && part ? (
            <View style={styles.summary}>
              <View style={styles.rowTop}>
                <Text style={[type.heading, styles.grow]} numberOfLines={2}>
                  {detail.customerName}
                </Text>
                <PickStatusPill status={part.status} />
              </View>
              <Text style={type.secondary}>
                {[
                  part.warehouseName,
                  t('mobile.picking.items', { n: lines.length }),
                  t('mobile.picking.deliver', { date: shortDate(detail.deliveryDate) }),
                ].join(' · ')}
              </Text>
              {part.pickerName ? (
                <Text style={type.secondary}>
                  {part.status === 'DONE'
                    ? t('mobile.picking.part.done', { name: part.pickerName })
                    : mine
                      ? t('mobile.picking.part.mine')
                      : t('mobile.picking.part.byOther', { name: part.pickerName })}
                </Text>
              ) : null}
              {detail.note ? (
                <Text style={type.secondary} numberOfLines={3}>
                  {detail.note}
                </Text>
              ) : null}
            </View>
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
        <View style={[styles.footer, { paddingBottom: footerPadding }]}>
          <PillButton
            title={t('mobile.picking.part.take')}
            height={56}
            loading={take.isPending}
            onPress={() => void takePart()}
          />
        </View>
      ) : null}
      {canConfirm ? (
        <View style={[styles.footer, { paddingBottom: footerPadding }]}>
          {body.uncounted > 0 ? (
            <Text style={[type.secondary, styles.center]}>
              {t('mobile.picking.part.uncountedNote', { n: body.uncounted })}
            </Text>
          ) : null}
          {info.data && body.missingBins > 0 ? (
            <Text style={[type.secondary, styles.center, styles.warning]}>
              {t('mobile.picking.part.missingShelves', { n: body.missingBins })}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <PillButton
              title={t('mobile.picking.part.scan')}
              variant="soft"
              icon={<ScanLine size={22} strokeWidth={2} color={colors.primary} />}
              height={56}
              style={styles.button}
              onPress={() => setScanning(true)}
            />
            <PillButton
              title={t('mobile.picking.part.confirm')}
              height={56}
              style={styles.button}
              disabled={!info.data || body.missingBins > 0 || lines.length === 0}
              loading={confirm.isPending}
              onPress={() => void confirmPart()}
            />
          </View>
        </View>
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
          qty={
            opened.qty && opened.unitId !== BASE_UNIT_ID
              ? ''
              : opened.qty
          }
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
  grow: { flex: 1, minWidth: 0, gap: 3 },
  center: { textAlign: 'center' },
  warning: { color: colors.warning, fontFamily: fonts.medium },
  link: { color: colors.primary, fontFamily: fonts.medium },
  pressed: { backgroundColor: colors.accent },
  highlighted: { backgroundColor: colors.secondary },
  problem: { marginHorizontal: 14 },
  list: { paddingHorizontal: 14, paddingTop: spacing.md },
  summary: {
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cell: { backgroundColor: colors.card },
  firstCell: {
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    overflow: 'hidden',
  },
  lastCell: {
    borderBottomLeftRadius: radii.card,
    borderBottomRightRadius: radii.card,
    overflow: 'hidden',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  loading: { marginTop: spacing.xl },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.xs,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    backgroundColor: colors.sheetBarFill,
  },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1 },
});
