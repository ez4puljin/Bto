import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PackageOpen, ScanLine, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, problemFrom } from '../../../../src/api/problem';
import {
  useAddCountLine,
  useBarcodeLookup,
  useFinishCount,
  useRemoveTransferLine,
  useTransferRequest,
} from '../../../../src/api/transfers';
import { formatQty } from '../../../../src/format/format';
import { useSignedIn } from '../../../../src/state/session';
import { colors, fonts, radii, spacing, TOUCH, type } from '../../../../src/theme/tokens';
import {
  findLineByProduct,
  finishReadiness,
  lineState,
  queuedByLine,
  shippedGroups,
} from '../../../../src/transfers/counts';
import { inUnit, lineQtyWords } from '../../../../src/transfers/grouping';
import { LineStateBadge } from '../../../../src/transfers/pills';
import { ScanSheet } from '../../../../src/transfers/scan-sheet';
import {
  type KeypadTarget,
  keypadUnitsOfLine,
  TransferKeypad,
} from '../../../../src/transfers/transfer-keypad';
import type {
  BarcodeResolution,
  TransferLine,
  TransferRequestGroup,
} from '../../../../src/transfers/types';
import { useCountQueue } from '../../../../src/transfers/use-count-queue';
import { PillButton } from '../../../../src/ui/controls';
import { Separator } from '../../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
import { ActionSheet } from '../../../../src/ui/sheet';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';
import { useToast } from '../../../../src/ui/toast';

interface GroupSection {
  group: TransferRequestGroup;
  data: TransferLine[];
}

/** The keypad is open for a shipped line, or for a product the request does not have. */
type KeypadFor =
  | {
      kind: 'line';
      group: TransferRequestGroup;
      line: TransferLine;
      /** The scanned unit (any of the product's), preselected; null when the row was tapped. */
      scanned: BarcodeResolution['unit'] | null;
    }
  | { kind: 'extra'; group: TransferRequestGroup; found: BarcodeResolution };

/**
 * Receiving by scan (ADR-0116 #4, #5): the shipped groups' lines in one list by sender; a read
 * barcode lands on the product's line, shows what was shipped in the scanned unit and opens the
 * keypad for what arrived («Ирээгүй» = 0); a tap on a row does the same. A product not on the
 * request is added as an unrequested line, counted at once. Each count goes into the FIFO queue
 * (`PUT /transfers/:id/counts`, one at a time); a failed send waits for «Дахин илгээх». Per
 * sender, «тоолж дуусгах» once nothing is unsent and every line is counted.
 */
export default function TransferReceiveScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { server } = useSignedIn();
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number.parseInt(id ?? '0', 10);
  const request = useTransferRequest(requestId);
  const queue = useCountQueue();
  const lookup = useBarcodeLookup();
  const addLine = useAddCountLine();
  const removeLine = useRemoveTransferLine();
  const finish = useFinishCount();
  const list = useRef<SectionList<TransferLine, GroupSection>>(null);

  const [scanning, setScanning] = useState(false);
  const [keypad, setKeypad] = useState<KeypadFor | null>(null);
  const [adding, setAdding] = useState<BarcodeResolution | null>(null);
  const [removing, setRemoving] = useState<TransferLine | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const groups = useMemo(() => shippedGroups(request.data?.groups ?? []), [request.data]);
  const sections = useMemo<GroupSection[]>(
    () => groups.map((group) => ({ group, data: group.lines })),
    [groups],
  );
  const queued = useMemo(() => queuedByLine(queue.entries), [queue.entries]);

  // A count the server dropped because the keeper moved the group on: said once.
  useEffect(() => {
    if (queue.dropped === null) return;
    toast.show({ message: t('mobile.transfers.receive.stateDropped'), durationMs: 6_000 });
    queue.acknowledgeDropped();
  }, [queue, toast, t]);

  const scrollTo = (lineId: number) => {
    const sectionIndex = sections.findIndex((section) =>
      section.data.some((line) => line.id === lineId),
    );
    if (sectionIndex === -1) return;
    const itemIndex = sections[sectionIndex]?.data.findIndex((line) => line.id === lineId) ?? -1;
    if (itemIndex === -1) return;
    list.current?.scrollToLocation({ sectionIndex, itemIndex, viewPosition: 0.3, animated: true });
  };

  const onCode = async (code: string) => {
    setScanning(false);
    setProblem(null);
    try {
      const found = await lookup(code);
      if (!found) {
        toast.show({ message: t('mobile.transfers.receive.unknownBarcode') });
        return;
      }
      const hit = findLineByProduct(groups, found.product.id);
      if (hit) {
        setHighlighted(hit.line.id);
        scrollTo(hit.line.id);
        setKeypad({ kind: 'line', group: hit.group, line: hit.line, scanned: found.unit });
        return;
      }
      setAdding(found);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const countLine = (
    group: TransferRequestGroup,
    line: TransferLine,
    unitId: number,
    qty: string,
  ) => {
    setKeypad(null);
    queue.add({ groupId: group.id, lineId: line.id, productUnitId: unitId, qty });
  };

  const addExtra = async (group: TransferRequestGroup, found: BarcodeResolution, qty: string) => {
    setKeypad(null);
    setProblem(null);
    try {
      await addLine.mutateAsync({
        groupId: group.id,
        key: Crypto.randomUUID(),
        productId: found.product.id,
        productUnitId: found.unit.id,
        qty,
      });
      toast.show({ message: t('mobile.transfers.receive.added') });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const finishGroup = async (group: TransferRequestGroup) => {
    setProblem(null);
    try {
      await finish.mutateAsync(group.id);
      toast.show({
        message: t('mobile.transfers.receive.finished', { warehouse: group.sourceWarehouseName }),
      });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const keypadTarget = (): { target: KeypadTarget; unitId: number; qty: string } | null => {
    if (!keypad) return null;
    if (keypad.kind === 'line') {
      const { line, scanned } = keypad;
      const units = keypadUnitsOfLine(line, scanned);
      const unitId = scanned?.id ?? line.requestUnitId;
      const factor = units.find((unit) => unit.id === unitId)?.factorToBase ?? '1';
      return {
        target: { name: line.productName, sku: line.productSku, thumbUrl: null, units },
        unitId,
        qty: line.countedQtyBase === null ? '' : inUnit(line.countedQtyBase, factor),
      };
    }
    const { found } = keypad;
    return {
      target: {
        name: found.product.name,
        sku: found.product.sku,
        thumbUrl: found.product.thumbUrl,
        units: [
          {
            id: found.unit.id,
            uomName: found.unit.uomName,
            factorToBase: found.unit.factorToBase,
            isBase: found.unit.isBase,
            wholesale: null,
          },
          ...(found.unit.isBase
            ? []
            : [
                {
                  id: found.product.baseUnit.id,
                  uomName: found.product.baseUnit.uomName,
                  factorToBase: '1',
                  isBase: true,
                  wholesale: null,
                },
              ]),
        ],
      },
      unitId: found.unit.id,
      qty: '',
    };
  };
  const opened = keypadTarget();

  const renderLine = ({
    item,
    index,
    section,
  }: {
    item: TransferLine;
    index: number;
    section: GroupSection;
  }) => {
    const qty = lineQtyWords(item);
    const pending = queued.get(item.id);
    const state = lineState(item);
    const countedText = pending
      ? t('mobile.transfers.receive.unsentCount', { qty: formatQty(pending.qty) })
      : qty.counted
        ? state.kind === 'notArrived'
          ? t('mobile.transfers.receive.notArrived')
          : t('mobile.transfers.receive.counted', qty.counted)
        : null;
    return (
      <View
        style={[
          styles.cell,
          index === 0 && styles.firstCell,
          index === section.data.length - 1 && styles.lastCell,
        ]}
      >
        {index > 0 ? <Separator /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.transfers.receive.countLine', { name: item.productName })}
          onPress={() =>
            setKeypad({ kind: 'line', group: section.group, line: item, scanned: null })
          }
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
                qty.shipped ? t('mobile.transfers.receive.shippedLine', qty.shipped) : null,
                countedText,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
            </Text>
            <LineStateBadge
              state={pending ? { kind: 'unchecked' } : state}
              baseUnit={item.baseUnitName}
            />
          </View>
          {item.unrequested ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.transfers.receive.removeLine')}
              onPress={() => setRemoving(item)}
              hitSlop={6}
              style={styles.trash}
            >
              <Trash2 size={18} strokeWidth={2} color={colors.destructive} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    );
  };

  const renderFooter = ({ section }: { section: GroupSection }) => {
    const readiness = finishReadiness(section.group, queue.entries);
    return (
      <View style={styles.sectionFooter}>
        <PillButton
          title={t('mobile.transfers.receive.finish', {
            warehouse: section.group.sourceWarehouseName,
          })}
          height={44}
          disabled={!readiness.ready || finish.isPending}
          loading={finish.isPending && finish.variables === section.group.id}
          onPress={() => void finishGroup(section.group)}
        />
        {readiness.unchecked > 0 ? (
          <Text style={[type.secondary, styles.center]}>
            {t('mobile.transfers.receive.uncounted', { n: readiness.unchecked })}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.transfers.receive.title')}
        onBack={() => router.back()}
        right={null}
      />
      {queue.failed ? (
        <View style={styles.failed}>
          <Text style={[type.body, styles.failedText]}>
            {t('mobile.transfers.receive.unsent', { n: queue.entries.length })}
          </Text>
          <PillButton
            title={t('mobile.transfers.receive.resend')}
            variant="destructive"
            height={36}
            onPress={queue.resend}
          />
        </View>
      ) : null}
      {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
      <SectionList<TransferLine, GroupSection>
        ref={list}
        sections={sections}
        keyExtractor={(line) => String(line.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 90 },
        ]}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
            {section.group.number
              ? t('mobile.transfers.request.group', {
                  warehouse: section.group.sourceWarehouseName,
                  number: section.group.number,
                })
              : section.group.sourceWarehouseName}
          </Text>
        )}
        renderItem={renderLine}
        renderSectionFooter={renderFooter}
        onScrollToIndexFailed={() => undefined}
        refreshing={request.isRefetching}
        onRefresh={() => void request.refetch()}
        ListEmptyComponent={
          request.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : request.error ? (
            <ProblemText problem={problemFrom(request.error)} />
          ) : (
            <EmptyState
              icon={<PackageOpen size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.transfers.receive.nothingShipped')}
            />
          )
        }
      />
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={t('mobile.transfers.receive.scan')}
          icon={<ScanLine size={22} strokeWidth={2} color={colors.primaryForeground} />}
          height={56}
          disabled={groups.length === 0}
          onPress={() => setScanning(true)}
        />
      </View>

      {keypad && opened ? (
        <TransferKeypad
          visible
          target={opened.target}
          server={server}
          unitId={opened.unitId}
          qty={opened.qty}
          subtitle={(unit) =>
            keypad.kind === 'line' && keypad.line.shippedQtyBase !== null
              ? unit.isBase
                ? t('mobile.transfers.receive.shippedBase', {
                    qty: formatQty(keypad.line.shippedQtyBase),
                    unit: unit.uomName,
                  })
                : t('mobile.transfers.receive.shippedIn', {
                    qty: inUnit(keypad.line.shippedQtyBase, unit.factorToBase),
                    unit: unit.uomName,
                    base: formatQty(keypad.line.shippedQtyBase),
                    baseUnit: keypad.line.baseUnitName,
                  })
              : keypad.kind === 'extra'
                ? `${keypad.found.product.sku} · ${t('mobile.transfers.receive.states.extra')}`
                : keypad.line.productSku
          }
          {...(keypad.kind === 'line'
            ? {
                extra: {
                  label: t('mobile.transfers.receive.notArrived'),
                  onPress: () => countLine(keypad.group, keypad.line, opened.unitId, '0'),
                },
              }
            : {})}
          onDone={(unitId, qty) => {
            if (keypad.kind === 'line') countLine(keypad.group, keypad.line, unitId, qty);
            else void addExtra(keypad.group, keypad.found, qty);
          }}
          onCancel={() => setKeypad(null)}
        />
      ) : null}
      <ScanSheet
        visible={scanning}
        hint={t('mobile.transfers.receive.scanHint')}
        onCode={(code) => void onCode(code)}
        onClose={() => setScanning(false)}
      />
      <ActionSheet
        visible={adding !== null}
        title={t('mobile.transfers.receive.addTitle')}
        message={adding ? t('mobile.transfers.receive.addHint', { name: adding.product.name }) : ''}
        actions={groups.map((group) => ({
          label:
            groups.length > 1
              ? t('mobile.transfers.receive.addTo', { warehouse: group.sourceWarehouseName })
              : t('mobile.transfers.receive.addLine'),
          onPress: () => {
            if (!adding) return;
            setKeypad({ kind: 'extra', group, found: adding });
            setAdding(null);
          },
        }))}
        cancelLabel={t('common.cancel')}
        onCancel={() => setAdding(null)}
      />
      <ActionSheet
        visible={removing !== null}
        title={t('mobile.transfers.receive.removeTitle')}
        message={removing?.productName ?? ''}
        actions={[
          {
            label: t('mobile.transfers.receive.removeLine'),
            destructive: true,
            onPress: () => {
              const line = removing;
              setRemoving(null);
              if (!line) return;
              setProblem(null);
              removeLine.mutate(line.id, {
                onSuccess: () => toast.show({ message: t('mobile.transfers.receive.removed') }),
                onError: (error) => setProblem(problemFrom(error)),
              });
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setRemoving(null)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 3 },
  center: { textAlign: 'center' },
  pressed: { backgroundColor: colors.accent },
  highlighted: { backgroundColor: colors.secondary },
  failed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: 14,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: 14,
    paddingRight: spacing.sm,
    borderRadius: radii.field,
    backgroundColor: colors.destructiveSoft,
  },
  failedText: { flex: 1, color: colors.destructive, fontFamily: fonts.medium },
  problem: { marginHorizontal: 14 },
  list: { paddingHorizontal: 14 },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, paddingHorizontal: 2 },
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
  trash: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  sectionFooter: { gap: spacing.xs, paddingTop: spacing.sm },
  loading: { marginTop: spacing.xl },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    backgroundColor: colors.sheetBarFill,
  },
});
