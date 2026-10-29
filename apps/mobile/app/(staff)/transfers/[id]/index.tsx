import { useLocalSearchParams, useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, problemFrom } from '../../../../src/api/problem';
import {
  useCancelTransferRequest,
  useReopenTransferRequest,
  useRequestTransfer,
  useTransferRequest,
} from '../../../../src/api/transfers';
import { ubDate, ubTime } from '../../../../src/dates/dates';
import { colors, fonts, radii, spacing, type } from '../../../../src/theme/tokens';
import { lineState } from '../../../../src/transfers/counts';
import { lineQtyWords, numbersLabel } from '../../../../src/transfers/grouping';
import { DraftPill, LineStateBadge, TransferStatusPill } from '../../../../src/transfers/pills';
import type { TransferLine, TransferRequestGroup } from '../../../../src/transfers/types';
import { PillButton } from '../../../../src/ui/controls';
import { Separator } from '../../../../src/ui/grouped';
import { ProblemText } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
import { ActionSheet } from '../../../../src/ui/sheet';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';
import { useToast } from '../../../../src/ui/toast';

/**
 * One request (ADR-0116): its numbers and status, the note, and the groups as cards — the sender
 * with its TR- number and status, the lines (asked, shipped, counted or «Ирээгүй», «Хүсэлтэд
 * байхгүй» on a product the store added), the keeper's reason when a count was sent back. Then
 * «Хүлээн авах» while a group is on the way, «Засах» and «Хүсэлт цуцлах» before shipping (a sent
 * request is reopened first), «Илгээх» for a draft the server holds.
 */
export default function TransferRequestScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const renderLine = (line: TransferLine, group: TransferRequestGroup, index: number) => {
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
      <View key={line.id}>
        {index > 0 ? <Separator /> : null}
        <View style={styles.line}>
          <View style={styles.grow}>
            <Text style={type.row} numberOfLines={2}>
              {line.productName}
            </Text>
            <Text style={type.secondary} numberOfLines={2}>
              {[line.productSku, ...parts].join(' · ')}
            </Text>
          </View>
          {line.unrequested ? (
            <LineStateBadge state={{ kind: 'extra' }} baseUnit={line.baseUnitName} />
          ) : counted && state.kind !== 'unchecked' ? (
            <LineStateBadge state={state} baseUnit={line.baseUnitName} />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={label ?? t('mobile.transfers.request.title')}
        onBack={() => router.back()}
        right={data ? label ? <TransferStatusPill status={data.status} /> : <DraftPill /> : null}
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl },
        ]}
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
            <View style={styles.head}>
              <Text style={type.title3}>{data.destWarehouseName}</Text>
              <Text style={type.secondary}>
                {data.requestedAt
                  ? t('mobile.transfers.request.requestedAt', {
                      date: ubDate(data.requestedAt),
                      time: ubTime(data.requestedAt),
                    })
                  : t('mobile.transfers.request.createdAt', {
                      date: ubDate(data.createdAt),
                      time: ubTime(data.createdAt),
                    })}
              </Text>
              {data.note ? (
                <Text style={type.body}>
                  {t('mobile.transfers.request.note', { note: data.note })}
                </Text>
              ) : null}
            </View>

            {data.groups.map((group) => (
              <View key={group.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={[type.rowStrong, styles.grow]} numberOfLines={2}>
                    {group.number
                      ? t('mobile.transfers.request.group', {
                          warehouse: group.sourceWarehouseName,
                          number: group.number,
                        })
                      : group.sourceWarehouseName}
                  </Text>
                  <TransferStatusPill status={group.status} />
                </View>
                {group.countReturnReason ? (
                  <View style={styles.returned}>
                    <TriangleAlert size={16} strokeWidth={2.2} color={colors.warningText} />
                    <Text style={[type.body, styles.returnedText]}>
                      {t('mobile.transfers.request.returnReason', {
                        reason: group.countReturnReason,
                      })}
                    </Text>
                  </View>
                ) : null}
                {group.lines.map((line, index) => renderLine(line, group, index))}
              </View>
            ))}

            {problem ? <ProblemText problem={problem} /> : null}

            <View style={styles.actions}>
              {shipped ? (
                <PillButton
                  title={t('mobile.transfers.request.receive')}
                  onPress={() => router.push(`/transfers/${data.id}/receive`)}
                />
              ) : null}
              {data.status === 'DRAFT' ? (
                <PillButton
                  title={t('mobile.transfers.request.send')}
                  loading={send.isPending}
                  disabled={busy}
                  onPress={() =>
                    void act(() => send.mutateAsync(data.id), t('mobile.transfers.request.sent'))
                  }
                />
              ) : null}
              {editable ? (
                <PillButton
                  title={t('common.edit')}
                  variant="white"
                  loading={reopen.isPending}
                  disabled={busy}
                  onPress={() => void edit()}
                />
              ) : null}
              {editable ? (
                <PillButton
                  title={t('mobile.transfers.request.cancel')}
                  variant="destructive"
                  disabled={busy}
                  onPress={() => setCancelling(true)}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
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
  body: { paddingHorizontal: 14, paddingTop: spacing.md, gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  loading: { marginTop: spacing.xl },
  head: { gap: spacing.xs, paddingHorizontal: 2 },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingVertical: spacing.xs,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  returned: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
  },
  returnedText: { flex: 1, color: colors.warningText, fontFamily: fonts.medium },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
