import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Check,
  CloudOff,
  Minus,
  PackageOpen,
  Plus,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
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
import { colors, radii, spacing, tabular, TOUCH, type } from '../../../../src/theme/tokens';
import {
  findLineByProduct,
  finishReadiness,
  lineState,
  queuedByLine,
  shippedGroups,
} from '../../../../src/transfers/counts';
import { inUnit, lineQtyWords, numbersLabel } from '../../../../src/transfers/grouping';
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
import { Page, SectionHeader } from '../../../../src/ui/layout';
import { ActionSheet } from '../../../../src/ui/sheet';
import { Card, FooterBar, Notice, ProgressBar } from '../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';
import { useToast } from '../../../../src/ui/toast';

const DASH = '—';

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
 * Receiving by scan (ADR-0116 #4, #5): a progress card (the counted lines of all), then the shipped
 * groups' lines in one grouped list per sender, each with a round mark, what was shipped, the
 * counted number and the state's pill; a read
 * barcode lands on the product's line, shows what was shipped in the scanned unit and opens the
 * keypad for what arrived («Ирээгүй» = 0); a tap on a row does the same. A product not on the
 * request is added as an unrequested line, counted at once. Each count goes into the FIFO queue
 * (`PUT /transfers/:id/counts`, one at a time); a failed send waits for «Дахин илгээх». Per
 * sender, «тоолж дуусгах» once nothing is unsent and every line is counted.
 */
export default function TransferReceiveScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
    const shown = pending ? { kind: 'unchecked' as const } : state;
    const number = pending ? formatQty(pending.qty) : qty.counted ? qty.counted.qty : null;
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
            (shown.kind === 'short' || shown.kind === 'over') && styles.lineOff,
            shown.kind === 'notArrived' && styles.lineOut,
            highlighted === item.id && styles.highlighted,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.mark, MARKS[shown.kind]]}>
            {shown.kind === 'exact' || shown.kind === 'extra' ? (
              <Check size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : shown.kind === 'short' ? (
              <Minus size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : shown.kind === 'over' ? (
              <Plus size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : shown.kind === 'notArrived' ? (
              <X size={16} strokeWidth={3} color={colors.primaryForeground} />
            ) : null}
          </View>
          <View style={styles.grow}>
            <Text style={type.rowStrong} numberOfLines={2}>
              {item.productName}
            </Text>
            <Text style={[type.secondary, tabular]} numberOfLines={2}>
              {[
                item.productSku,
                qty.shipped ? t('mobile.transfers.receive.shippedLine', qty.shipped) : null,
                pending ? countedText : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
            </Text>
          </View>
          <View style={styles.side}>
            <Text
              accessibilityLabel={countedText ?? t('mobile.transfers.receive.states.unchecked')}
              style={[
                type.heading,
                tabular,
                (shown.kind === 'short' || shown.kind === 'over') && { color: colors.warning },
                shown.kind === 'notArrived' && { color: colors.destructive },
                (number === null || pending !== undefined) && { color: colors.muted },
              ]}
            >
              {number ?? DASH}
            </Text>
            <LineStateBadge state={shown} baseUnit={item.baseUnitName} />
          </View>
          {item.unrequested ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.transfers.receive.removeLine')}
              onPress={() => setRemoving(item)}
              style={({ pressed }) => [styles.trash, pressed && styles.faded]}
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
          variant="soft"
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

  const allLines = groups.flatMap((group) => group.lines);
  const countedLines = allLines.filter(
    (line) => !queued.has(line.id) && lineState(line).kind !== 'unchecked',
  ).length;
  const numbers = request.data
    ? numbersLabel(request.data.groups.map((group) => group.number))
    : null;

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.transfers.receive.title')}
        subtitle={numbers}
        onBack={() => router.back()}
      />
      {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
      <SectionList<TransferLine, GroupSection>
        ref={list}
        style={styles.fill}
        sections={sections}
        keyExtractor={(line) => String(line.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.top}>
            {allLines.length > 0 ? (
              <Card style={styles.progress}>
                <View style={styles.progressTop}>
                  <Text style={type.rowStrong}>{t('mobile.transfers.receive.progressTitle')}</Text>
                  <Text style={[type.rowStrong, tabular, styles.link]}>
                    {t('mobile.transfers.receive.progress', {
                      done: countedLines,
                      total: allLines.length,
                    })}
                  </Text>
                </View>
                <ProgressBar value={countedLines / allLines.length} />
              </Card>
            ) : null}
            {queue.failed ? (
              <Notice
                icon={CloudOff}
                tone="bad"
                style={styles.failed}
                right={
                  <PillButton
                    title={t('mobile.transfers.receive.resend')}
                    variant="white"
                    height={36}
                    style={styles.resend}
                    onPress={queue.resend}
                  />
                }
              >
                {t('mobile.transfers.receive.unsent', { n: queue.entries.length })}
              </Notice>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader style={styles.sectionHeader}>
            {section.group.number
              ? t('mobile.transfers.request.group', {
                  warehouse: section.group.sourceWarehouseName,
                  number: section.group.number,
                })
              : section.group.sourceWarehouseName}
          </SectionHeader>
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
      <FooterBar>
        <PillButton
          title={t('mobile.transfers.receive.scan')}
          icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
          style={styles.fill}
          disabled={groups.length === 0}
          onPress={() => setScanning(true)}
        />
      </FooterBar>

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
  fill: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  center: { textAlign: 'center' },
  link: { color: colors.link },
  faded: { opacity: 0.6 },
  pressed: { backgroundColor: colors.accent },
  highlighted: { backgroundColor: colors.secondary },
  problem: { marginHorizontal: spacing.lg },
  list: { padding: spacing.lg, flexGrow: 1 },
  top: { gap: spacing.md },
  progress: { gap: spacing.sm, paddingVertical: 14 },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  failed: { alignItems: 'center', paddingRight: spacing.sm },
  resend: { paddingHorizontal: 14 },
  sectionHeader: { marginTop: spacing.lg },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lineOff: { backgroundColor: colors.warningSoft },
  lineOut: { backgroundColor: colors.destructiveSoft },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: { alignItems: 'flex-end', gap: spacing.xs, maxWidth: '42%' },
  trash: {
    width: TOUCH,
    height: TOUCH,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionFooter: { gap: spacing.sm, paddingTop: spacing.md },
  loading: { marginTop: spacing.xl },
});

/** The round mark before a line: green when it matches, orange when it differs, red when none came. */
const MARKS = StyleSheet.create({
  unchecked: { borderWidth: 2, borderColor: colors.fieldBorder },
  exact: { backgroundColor: colors.tint.green },
  extra: { backgroundColor: colors.tint.blue },
  short: { backgroundColor: colors.tint.orange },
  over: { backgroundColor: colors.tint.orange },
  notArrived: { backgroundColor: colors.tint.red },
});
