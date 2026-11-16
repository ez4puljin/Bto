import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pencil, ScanLine, Send, Trash2, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type AppProblem, problemFrom } from '../../../../src/api/problem';
import {
  useCancelTransferRequest,
  useReopenTransferRequest,
  useRequestTransfer,
  useTransferRequest,
} from '../../../../src/api/transfers';
import { shortDate, ubDate, ubTime } from '../../../../src/dates/dates';
import { colors, spacing, tabular, type } from '../../../../src/theme/tokens';
import { lineState } from '../../../../src/transfers/counts';
import { lineQtyWords, numbersLabel } from '../../../../src/transfers/grouping';
import {
  DraftPill,
  LineStateBadge,
  TransferStatusPill,
  TransferStatusTile,
} from '../../../../src/transfers/pills';
import { statusKey } from '../../../../src/transfers/statuses';
import type { TransferLine, TransferRequestGroup } from '../../../../src/transfers/types';
import { PillButton } from '../../../../src/ui/controls';
import { Group } from '../../../../src/ui/grouped';
import { ProblemText } from '../../../../src/ui/kit';
import { Page, SectionHeader } from '../../../../src/ui/layout';
import { ActionSheet } from '../../../../src/ui/sheet';
import { Card, FooterBar, Notice } from '../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';
import { useToast } from '../../../../src/ui/toast';

/**
 * One request (ADR-0116): its numbers as the header's title over the store and the date, the
 * status in a card under it (with the note), and the groups as grouped lists — the sender with its
 * TR- number and status over the list, the keeper's reason when a count was sent back, the lines
 * (asked, shipped, counted or «Ирээгүй», «Хүсэлтэд байхгүй» on a product the store added). The
 * bar under the page holds the actions: «Хүлээн авах» while a group is on the way, «Илгээх» for a
 * draft the server holds, «Засах» before shipping (a sent request is reopened first) and the round
 * red «Хүсэлт цуцлах».
 */
export default function TransferRequestScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number.parseInt(id ?? '0', 10);
  const request = useTransferRequest(requestId);
  const send = useRequestTransfer();
  const reopen = useReopenTransferRequest();
  const cancel = useCancelTransferRequest();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const data = request.data;
  const busy = send.isPending || reopen.isPending || cancel.isPending;

  const label = data ? numbersLabel(data.groups.map((group) => group.number)) : null;
  const shipped = data?.groups.some((group) => group.status === 'SHIPPED') ?? false;
  const editable = data?.status === 'DRAFT' || data?.status === 'REQUESTED';

  const act = async (action: () => Promise<unknown>, message: string | null) => {
    setProblem(null);
    try {
      await action();
      if (message) toast.show({ message });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const edit = async () => {
    if (!data) return;
    if (data.status === 'REQUESTED') {
      await act(async () => {
        await reopen.mutateAsync(data.id);
        router.push(`/transfers/new?id=${data.id}`);
      }, null);
      return;
    }
    router.push(`/transfers/new?id=${data.id}`);
  };

  const renderLine = (line: TransferLine, group: TransferRequestGroup) => {
    const qty = lineQtyWords(line);
    const state = lineState(line);
    const counted = group.status === 'COUNTED' || group.status === 'RECEIVED';
    const parts = [
      t('mobile.transfers.request.requested', qty.requested),
      qty.shipped && group.status !== 'DRAFT' && group.status !== 'REQUESTED'
        ? t('mobile.transfers.request.shipped', qty.shipped)
        : null,
      qty.counted && (counted || line.countedQtyBase !== null)
        ? state.kind === 'notArrived'
          ? t('mobile.transfers.request.notArrived')
          : t('mobile.transfers.request.counted', qty.counted)
        : null,
    ].filter((part): part is string => part !== null);
    return (
      <View key={line.id} style={styles.line}>
        <View style={styles.grow}>
          <Text style={type.rowStrong} numberOfLines={2}>
            {line.productName}
          </Text>
          <Text style={[type.secondary, tabular]} numberOfLines={2}>
            {[line.productSku, ...parts].join(' · ')}
          </Text>
        </View>
        {line.unrequested ? (
          <LineStateBadge state={{ kind: 'extra' }} baseUnit={line.baseUnitName} />
        ) : counted && state.kind !== 'unchecked' ? (
          <LineStateBadge state={state} baseUnit={line.baseUnitName} />
        ) : null}
      </View>
    );
  };

  const at = data ? (data.requestedAt ?? data.createdAt) : null;
  const lineCount = data ? data.groups.reduce((sum, group) => sum + group.lines.length, 0) : 0;
  const hasActions = data !== undefined && (shipped || editable);

  return (
    <Page edges={[]}>
      <StoreHeader
        title={label ?? t('mobile.transfers.request.title')}
        subtitle={
          data && at
            ? [
                data.destWarehouseName,
                t(
                  data.requestedAt
                    ? 'mobile.transfers.request.requestedAt'
                    : 'mobile.transfers.request.createdAt',
                  { date: shortDate(ubDate(at)), time: ubTime(at) },
                ),
              ].join(' · ')
            : null
        }
        onBack={() => router.back()}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={request.isRefetching}
            onRefresh={() => void request.refetch()}
          />
        }
      >
        {!data ? (
          request.error ? (
            <ProblemText problem={problemFrom(request.error)} />
          ) : (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          )
        ) : (
          <>
            <Card style={styles.status}>
              <View style={styles.statusTop}>
                <TransferStatusTile status={label ? data.status : 'DRAFT'} />
                <View style={styles.statusText}>
                  <Text style={type.rowStrong} numberOfLines={1}>
                    {t(statusKey(label ? data.status : 'DRAFT'))}
                  </Text>
                  <Text style={[type.secondary, tabular]} numberOfLines={1}>
                    {[
                      t('mobile.transfers.home.items', { n: lineCount }),
                      data.groups.length > 1
                        ? t('mobile.transfers.home.groups', { n: data.groups.length })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {label ? <TransferStatusPill status={data.status} /> : <DraftPill />}
              </View>
              {data.note ? (
                <Text style={type.body}>
                  {t('mobile.transfers.request.note', { note: data.note })}
                </Text>
              ) : null}
            </Card>

            {data.groups.map((group) => (
              <View key={group.id} style={styles.group}>
                <SectionHeader
                  style={styles.sectionHeader}
                  right={<TransferStatusPill status={group.status} />}
                >
                  {group.number
                    ? t('mobile.transfers.request.group', {
                        warehouse: group.sourceWarehouseName,
                        number: group.number,
                      })
                    : group.sourceWarehouseName}
                </SectionHeader>
                {group.countReturnReason ? (
                  <Notice icon={TriangleAlert} tone="warn">
                    {t('mobile.transfers.request.returnReason', {
                      reason: group.countReturnReason,
                    })}
                  </Notice>
                ) : null}
                <Group>{group.lines.map((line) => renderLine(line, group))}</Group>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {data && hasActions ? (
        <FooterBar column>
          {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
          <View style={styles.actions}>
            {editable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.transfers.request.cancel')}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => setCancelling(true)}
                style={({ pressed }) => [
                  styles.cancel,
                  pressed && styles.cancelPressed,
                  busy && styles.disabled,
                ]}
              >
                <Trash2 size={22} strokeWidth={2} color={colors.destructive} />
              </Pressable>
            ) : null}
            {editable ? (
              <PillButton
                title={t('common.edit')}
                variant="soft"
                icon={<Pencil size={18} strokeWidth={2.2} color={colors.link} />}
                style={styles.action}
                loading={reopen.isPending}
                disabled={busy}
                onPress={() => void edit()}
              />
            ) : null}
            {data.status === 'DRAFT' ? (
              <PillButton
                title={t('mobile.transfers.request.send')}
                icon={<Send size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
                style={styles.action}
                loading={send.isPending}
                disabled={busy}
                onPress={() =>
                  void act(() => send.mutateAsync(data.id), t('mobile.transfers.request.sent'))
                }
              />
            ) : null}
            {shipped ? (
              <PillButton
                title={t('mobile.transfers.request.receive')}
                icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
                style={styles.action}
                onPress={() => router.push(`/transfers/${data.id}/receive`)}
              />
            ) : null}
          </View>
        </FooterBar>
      ) : problem ? (
        <ProblemText problem={problem} style={styles.loose} />
      ) : null}
      <ActionSheet
        visible={cancelling}
        title={t('mobile.transfers.request.cancelTitle')}
        message={t('mobile.transfers.request.cancelHint')}
        actions={[
          {
            label: t('mobile.transfers.request.cancel'),
            destructive: true,
            onPress: () => {
              setCancelling(false);
              if (!data) return;
              void act(
                () => cancel.mutateAsync({ id: data.id }),
                t('mobile.transfers.request.cancelled'),
              );
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setCancelling(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  loading: { marginTop: spacing.xl },
  status: { gap: spacing.sm, paddingVertical: spacing.md },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusText: { flex: 1, minWidth: 0 },
  group: { gap: spacing.sm },
  sectionHeader: { marginTop: spacing.xs, marginBottom: 0 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  problem: { marginTop: 0 },
  loose: { margin: spacing.lg },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { flex: 1 },
  cancel: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.destructiveSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
