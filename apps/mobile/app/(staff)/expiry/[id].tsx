import { isSystemRole } from '@tugeel/shared/auth';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type ExpiryChange,
  type ExpiryItem,
  type ExpiryRole,
  type ExpiryStatus,
  useBaseUnitFractional,
  useExpiryHistory,
  useExpiryItem,
  useExpirySummary,
  usePatchExpiryItem,
  useSetExpiryStatus,
} from '../../../src/api/expiry';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad, useAt } from '../../../src/community/parts';
import { DaysText, ExpiryFields, ExpiryStatusPill, QtyCells } from '../../../src/expiry/parts';
import {
  displayDate,
  type ExpiryEdits,
  type ExpiryForm,
  formOf,
  hasProblems,
  movesOf,
  OPEN_STATUSES,
  patchOf,
  problemsOfEdit,
} from '../../../src/expiry/rules';
import { formatQty } from '../../../src/format/format';
import { mayManageExpiry } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** One record (ADR-0172 #3, #6, #9), once it has loaded. */
export default function ExpiryRecordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const parsed = Number.parseInt(params.id ?? '', 10);
  const item = useExpiryItem(Number.isNaN(parsed) ? null : parsed);
  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.expiry.record.title')}
        onBack={() => router.back()}
        right={null}
      />
      {item.data ? (
        <RecordBody item={item.data} refetch={item.refetch} refreshing={item.isRefetching} />
      ) : (
        <FirstLoad query={item}>{null}</FirstLoad>
      )}
    </Page>
  );
}

/**
 * The product, the date and its days; a correction that sends only what changed, with the version
 * it read, and keeps what was typed when someone else got there first; for a holder of the right
 * the status and archive; the liability to read (it is assigned on the web); who added it; the
 * history, oldest first. An archived record is read-only until it is restored.
 */
function RecordBody({
  item,
  refetch,
  refreshing,
}: {
  item: ExpiryItem;
  refetch: () => Promise<{ data: ExpiryItem | undefined }>;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const at = useAt();
  const { me } = useSignedIn();
  const manager = mayManageExpiry(me);
  const today = useExpirySummary().data?.today ?? null;
  const fractional = useBaseUnitFractional(item.product.id);
  const history = useExpiryHistory(item.id);
  const patch = usePatchExpiryItem();
  const setStatus = useSetExpiryStatus();

  const [edits, setEdits] = useState<ExpiryEdits>({});
  // The version the typing started from. A background read while typing must not move it, or the
  // save would overwrite someone's change unseen; only the reload after a refusal does (ADR-0118).
  const [readVersion, setReadVersion] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const archived = item.status === 'ARCHIVED';
  const body = patchOf(item, edits, readVersion ?? item.editVersion);
  const problems = problemsOfEdit(item, edits, today, fractional);
  const edited = !archived && body !== null;

  // Archiving drops a correction in progress: a restored record starts from what it holds.
  useEffect(() => {
    if (!archived) return;
    setEdits({});
    setReadVersion(null);
    setChecked(false);
  }, [archived]);

  const change = (next: Partial<ExpiryForm>) => {
    setReadVersion((current) => current ?? item.editVersion);
    setEdits((current) => ({ ...current, ...next }));
  };

  const save = async () => {
    setChecked(true);
    setProblem(null);
    if (body === null || hasProblems(problems)) return;
    try {
      await patch.mutateAsync({ id: item.id, body });
      setEdits({});
      setReadVersion(null);
      setChecked(false);
      toast.show({ message: t('mobile.expiry.record.saved') });
    } catch (error) {
      const failure = problemFrom(error);
      if (failure.code === 'EXPIRY_ITEM_CHANGED') {
        toast.show({ message: t('errors.EXPIRY_ITEM_CHANGED') });
        const fresh = await refetch();
        if (fresh.data) setReadVersion(fresh.data.editVersion);
        return;
      }
      setProblem(failure);
      if (failure.code === 'EXPIRY_ITEM_ARCHIVED') void refetch();
    }
  };

  const decide = async (status: ExpiryStatus, message: string) => {
    setChoosing(false);
    setArchiving(false);
    setProblem(null);
    try {
      await setStatus.mutateAsync({ id: item.id, status });
      toast.show({ message });
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const roleName = (role: ExpiryRole) =>
    role.code && isSystemRole(role.code) ? t(`roles.system.${role.code}`) : (role.name ?? '');
  const liable = [
    ...item.liability.roles.map(roleName),
    ...item.liability.users.map((user) => user.fullName),
  ].join(', ');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refetch();
              void history.refetch();
            }}
          />
        }
      >
        <View style={styles.card}>
          <Text style={type.heading} numberOfLines={3}>
            {item.product.name}
          </Text>
          <Text style={type.secondary} numberOfLines={1}>
            {`${item.product.sku} · ${item.product.baseUomName}`}
          </Text>
          {item.supplier ? (
            <Text style={type.secondary} numberOfLines={1}>
              {t('mobile.expiry.record.supplier', { name: item.supplier.name })}
            </Text>
          ) : null}
          {item.homeWarehouse ? (
            <Text style={type.secondary} numberOfLines={1}>
              {t('mobile.expiry.record.warehouse', { name: item.homeWarehouse.name })}
            </Text>
          ) : null}
          <View style={styles.line}>
            <Text style={[type.rowStrong, tabular]}>{displayDate(item.expiryDate)}</Text>
            <DaysText daysLeft={item.daysLeft} />
            <ExpiryStatusPill status={item.status} />
          </View>
          {archived ? (
            <QtyCells
              floor={item.qtyFloor}
              warehouse={item.qtyWarehouse}
              total={item.qtyTotal}
              unit={item.product.baseUomName}
            />
          ) : null}
          {archived && item.note ? <Text style={type.body}>{item.note}</Text> : null}
        </View>

        {archived ? (
          <View style={styles.card}>
            {item.archivedAt ? (
              <Text style={type.body}>
                {item.archivedByName
                  ? t('mobile.expiry.record.archivedBy', {
                      name: item.archivedByName,
                      at: at(item.archivedAt),
                    })
                  : t('mobile.expiry.record.archivedAt', { at: at(item.archivedAt) })}
              </Text>
            ) : null}
            <Text style={type.secondary}>
              {t('mobile.expiry.record.archivedHint', { status: t('expiry.status.REVIEW') })}
            </Text>
            {manager ? (
              <PillButton
                title={t('mobile.expiry.record.restore')}
                variant="soft"
                loading={setStatus.isPending}
                onPress={() => void decide('REVIEW', t('mobile.expiry.record.restored'))}
              />
            ) : null}
          </View>
        ) : (
          <View>
            <SectionHeader style={styles.head}>{t('mobile.expiry.record.correct')}</SectionHeader>
            <View style={styles.card}>
              <ExpiryFields
                form={formOf(item, edits)}
                onChange={change}
                problems={problems}
                checked={checked}
                today={today}
                fractional={fractional}
                unit={item.product.baseUomName}
              />
            </View>
          </View>
        )}

        {manager && !archived ? (
          <View style={styles.manage}>
            <Group>
              <Row
                title={t('mobile.expiry.record.status')}
                value={t(`expiry.status.${item.status}`)}
                onPress={() => setChoosing(true)}
              />
            </Group>
            <PillButton
              title={t('mobile.expiry.record.archive')}
              variant="destructive"
              loading={setStatus.isPending}
              onPress={() => setArchiving(true)}
            />
          </View>
        ) : null}

        <View>
          <SectionHeader style={styles.head}>{t('mobile.expiry.record.liability')}</SectionHeader>
          <Group>
            <Row
              title={t(`expiry.liabilityType.${item.liability.type}`)}
              subtitle={[liable, item.liability.note].filter(Boolean).join(' · ') || null}
            />
          </Group>
          <Text style={[type.secondary, styles.hint]}>
            {t('mobile.expiry.record.liabilityHint')}
          </Text>
        </View>

        <Group>
          <Row
            title={t('mobile.expiry.record.addedBy')}
            subtitle={t('mobile.expiry.record.who', {
              name: item.createdByName,
              at: at(item.createdAt),
            })}
          />
        </Group>

        <View>
          <SectionHeader style={styles.head}>{t('mobile.expiry.record.history')}</SectionHeader>
          {history.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : history.error ? (
            <ProblemText problem={problemFrom(history.error)} style={styles.historyProblem} />
          ) : (history.data?.data ?? []).length === 0 ? (
            <Text style={[type.secondary, styles.hint]}>{t('mobile.expiry.record.noHistory')}</Text>
          ) : (
            <Group>
              {(history.data?.data ?? []).map((entry) => (
                <HistoryRow key={entry.id} change={entry} />
              ))}
            </Group>
          )}
        </View>
      </ScrollView>

      {edited || problem ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <ProblemText problem={problem} style={styles.barProblem} />
          {edited ? (
            <PillButton
              title={t('common.save')}
              loading={patch.isPending}
              onPress={() => void save()}
            />
          ) : null}
        </View>
      ) : null}

      <ActionSheet
        visible={choosing}
        title={t('mobile.expiry.record.statusTitle')}
        actions={OPEN_STATUSES.filter((status) => status !== item.status).map((status) => ({
          label: t(`expiry.status.${status}`),
          onPress: () => void decide(status, t('mobile.expiry.record.statusSaved')),
        }))}
        cancelLabel={t('common.cancel')}
        onCancel={() => setChoosing(false)}
      />
      <ActionSheet
        visible={archiving}
        title={t('mobile.expiry.record.archiveTitle')}
        message={t('mobile.expiry.record.archiveMessage')}
        actions={[
          {
            label: t('mobile.expiry.record.archive'),
            destructive: true,
            onPress: () => void decide('ARCHIVED', t('mobile.expiry.record.archived')),
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setArchiving(false)}
      />
    </KeyboardAvoidingView>
  );
}

/** «Анх бүртгэсэн» with the first counts, or what moved; who and when under it. */
function HistoryRow({ change }: { change: ExpiryChange }) {
  const { t } = useTranslation();
  const at = useAt();
  const moves = movesOf(change);
  const lines = [
    moves.floor ? t('mobile.expiry.record.moveFloor', { ...moves.floor }) : null,
    moves.warehouse ? t('mobile.expiry.record.moveWarehouse', { ...moves.warehouse }) : null,
  ].filter((line) => line !== null);
  return (
    <View style={styles.change}>
      <Text style={type.rowStrong}>
        {change.kind === 'CREATE'
          ? t('mobile.expiry.record.created')
          : t('mobile.expiry.record.changed')}
      </Text>
      {change.kind === 'CREATE' || lines.length === 0 ? (
        <Text style={[type.body, tabular]}>
          {t('mobile.expiry.record.counts', {
            floor: formatQty(change.qtyFloorNew),
            warehouse: formatQty(change.qtyWarehouseNew),
          })}
        </Text>
      ) : (
        lines.map((line) => (
          <Text key={line} style={[type.body, tabular]}>
            {line}
          </Text>
        ))
      )}
      <Text style={type.secondary}>
        {t('mobile.expiry.record.who', {
          name: change.changedByName,
          at: at(change.changedAt),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  head: { marginTop: spacing.xs },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  manage: { gap: spacing.sm },
  loading: { marginTop: spacing.md },
  historyProblem: { marginTop: 0 },
  change: { paddingVertical: 10, paddingHorizontal: spacing.lg, gap: 2 },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
  barProblem: { marginTop: 0 },
});
