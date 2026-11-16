import { isSystemRole } from '@tugeel/shared/auth';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ArchiveRestore, PencilLine, Plus } from 'lucide-react-native';
import { useState } from 'react';
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
import { useLeaveGuard } from '../../../src/expiry/leave-guard';
import { DaysTile, ExpiryFields, ExpiryStatusPill, LeaveSheet } from '../../../src/expiry/parts';
import {
  displayDate,
  type ExpiryEdits,
  type ExpiryForm,
  formOf,
  hasProblems,
  keptByArchive,
  movesOf,
  OPEN_STATUSES,
  patchOf,
  problemsOfEdit,
  standingBeside,
} from '../../../src/expiry/rules';
import { formatQty } from '../../../src/format/format';
import { mayManageExpiry } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { Card, FooterBar } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** Why values typed over a record that has since been archived were not saved. */
const ARCHIVED_PROBLEM: AppProblem = { code: 'EXPIRY_ITEM_ARCHIVED', status: 409 };

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
 * A card with the days tile, the product, the date, the status and the three counts; a correction that sends only what changed, with the version
 * it read, and when someone else got there first keeps what was typed, says so until it is saved
 * and shows what stands now beside each typed field; for a holder of the right the status and
 * archive, which asks before it drops what was typed; the liability to read (it is assigned on the
 * web); who added it; the history, oldest first. An archived record is read-only until it is
 * restored; a correction someone else's archive beat stays readable until it is dismissed. Leaving
 * with something typed asks first.
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
  // Someone else's save refused this one: the notice stays, with what stands now beside each typed
  // field, until a save succeeds (ADR-0172 #6). A toast would fade before anyone could check.
  const [conflict, setConflict] = useState<AppProblem | null>(null);
  // What someone else's archive beat: read-only, and it stays until the person dismisses it.
  const [refused, setRefused] = useState<ExpiryEdits | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // This person's own archive, after the sheet told them that what is typed goes.
  const [ownArchive, setOwnArchive] = useState(false);

  const archived = item.status === 'ARCHIVED';
  const body = patchOf(item, edits, readVersion ?? item.editVersion);
  const problems = problemsOfEdit(item, edits, today, fractional);
  const edited = !archived && body !== null;
  const leaving = useLeaveGuard(edited);

  // An archive ends a correction in progress, by whichever route it arrived: a restored record
  // starts from what it holds. Done while rendering, as it reads the typing of this very render.
  const [wasArchived, setWasArchived] = useState(archived);
  if (archived !== wasArchived) {
    setWasArchived(archived);
    setOwnArchive(false);
    if (archived) {
      const kept = keptByArchive(item, edits, ownArchive);
      if (kept) setRefused(kept);
      setEdits({});
      setReadVersion(null);
      setChecked(false);
      setProblem(null);
      setConflict(null);
    }
  }

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
      setConflict(null);
      toast.show({ message: t('mobile.expiry.record.saved') });
    } catch (error) {
      const failure = problemFrom(error);
      if (failure.code === 'EXPIRY_ITEM_CHANGED') {
        setConflict(failure);
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
    setOwnArchive(status === 'ARCHIVED');
    try {
      await setStatus.mutateAsync({ id: item.id, status });
      toast.show({ message });
    } catch (error) {
      setOwnArchive(false);
      setProblem(problemFrom(error));
    }
  };

  /** What was typed, as a line of labelled values. */
  const typedLine = (typed: ExpiryEdits) =>
    [
      { label: t('mobile.expiry.fields.date'), value: typed.date },
      { label: t('mobile.expiry.row.floor'), value: typed.floor },
      { label: t('mobile.expiry.row.warehouse'), value: typed.warehouse },
      {
        label: t('mobile.expiry.fields.note'),
        value: typed.note === '' ? t('common.none') : typed.note,
      },
    ]
      .flatMap(({ label, value }) => (value === undefined ? [] : [`${label} ${value}`]))
      .join(' · ');

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
        <Card style={styles.top}>
          <View style={styles.topRow}>
            <DaysTile daysLeft={item.daysLeft} size={60} />
            <View style={styles.grow}>
              <Text style={type.title3} numberOfLines={3}>
                {item.product.name}
              </Text>
              <Text style={type.secondary} numberOfLines={1}>
                {`${item.product.sku} · ${item.product.baseUomName}`}
              </Text>
              <Text style={[type.rowStrong, tabular]}>{displayDate(item.expiryDate)}</Text>
            </View>
          </View>
          <ExpiryStatusPill status={item.status} />
          <View style={styles.stats}>
            {(
              [
                [item.qtyFloor, 'mobile.expiry.row.floor'],
                [item.qtyWarehouse, 'mobile.expiry.row.warehouse'],
                [item.qtyTotal, 'mobile.expiry.row.total'],
              ] as const
            ).map(([qty, label]) => (
              <View key={label} style={styles.stat}>
                <Text style={[type.title3, tabular]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatQty(qty)}
                </Text>
                <Text style={type.secondary} numberOfLines={1}>
                  {t(label)}
                </Text>
              </View>
            ))}
          </View>
          {item.supplier || item.homeWarehouse ? (
            <View style={styles.facts}>
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
            </View>
          ) : null}
          {archived && item.note ? <Text style={type.body}>{item.note}</Text> : null}
        </Card>

        {refused ? (
          <Card style={styles.card}>
            {archived ? <ProblemText problem={ARCHIVED_PROBLEM} style={styles.barProblem} /> : null}
            <Text style={type.body}>
              {t('mobile.expiry.record.notSaved', { values: typedLine(refused) })}
            </Text>
            <PillButton
              title={t('common.close')}
              variant="soft"
              height={44}
              onPress={() => setRefused(null)}
            />
          </Card>
        ) : null}

        {archived ? (
          <Card style={styles.card}>
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
                icon={<ArchiveRestore size={18} strokeWidth={2.2} color={colors.link} />}
                loading={setStatus.isPending}
                onPress={() => void decide('REVIEW', t('mobile.expiry.record.restored'))}
              />
            ) : null}
          </Card>
        ) : (
          <View>
            <SectionHeader style={styles.head}>{t('mobile.expiry.record.correct')}</SectionHeader>
            <Card>
              <ExpiryFields
                form={formOf(item, edits)}
                onChange={change}
                problems={problems}
                checked={checked}
                today={today}
                fractional={fractional}
                unit={item.product.baseUomName}
                beside={conflict ? standingBeside(item, edits) : null}
              />
            </Card>
          </View>
        )}

        <View>
          <SectionHeader style={styles.head}>{t('mobile.expiry.record.liability')}</SectionHeader>
          <Group>
            {manager && !archived ? (
              <Row
                title={t('mobile.expiry.record.status')}
                value={t(`expiry.status.${item.status}`)}
                onPress={() => setChoosing(true)}
              />
            ) : null}
            {/* No line limit: this is the only place on the phone to read who is liable. */}
            <View style={styles.liability}>
              <Text style={type.row}>{t(`expiry.liabilityType.${item.liability.type}`)}</Text>
              {liable ? <Text style={type.secondary}>{liable}</Text> : null}
              {item.liability.note ? (
                <Text style={type.secondary}>{item.liability.note}</Text>
              ) : null}
            </View>
            <Row
              title={t('mobile.expiry.record.addedBy')}
              subtitle={t('mobile.expiry.record.who', {
                name: item.createdByName,
                at: at(item.createdAt),
              })}
            />
          </Group>
          <Text style={[type.secondary, styles.hint]}>
            {t('mobile.expiry.record.liabilityHint')}
          </Text>
        </View>

        <View>
          <SectionHeader style={styles.head}>{t('mobile.expiry.record.history')}</SectionHeader>
          {history.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : history.error ? (
            <ProblemText problem={problemFrom(history.error)} style={styles.historyProblem} />
          ) : (history.data?.data ?? []).length === 0 ? (
            <Text style={[type.secondary, styles.hint]}>{t('mobile.expiry.record.noHistory')}</Text>
          ) : (
            <Group inset={ICON_INSET}>
              {(history.data?.data ?? []).map((entry) => (
                <HistoryRow key={entry.id} change={entry} />
              ))}
            </Group>
          )}
        </View>

        {manager && !archived ? (
          <PillButton
            title={t('mobile.expiry.record.archive')}
            variant="destructive"
            icon={<Archive size={18} strokeWidth={2.2} color={colors.destructive} />}
            loading={setStatus.isPending}
            onPress={() => setArchiving(true)}
          />
        ) : null}
      </ScrollView>

      {edited || problem ? (
        <FooterBar column>
          <ProblemText problem={problem ?? (edited ? conflict : null)} style={styles.barProblem} />
          {edited ? (
            <PillButton
              title={t('common.save')}
              loading={patch.isPending}
              onPress={() => void save()}
            />
          ) : null}
        </FooterBar>
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
        title={
          edited ? t('expiry.panel.archiveDirtyTitle') : t('mobile.expiry.record.archiveTitle')
        }
        message={
          edited
            ? t('expiry.panel.archiveDirtyDescription')
            : t('mobile.expiry.record.archiveMessage')
        }
        actions={[
          {
            label: edited
              ? t('expiry.panel.archiveDirtyConfirm')
              : t('mobile.expiry.record.archive'),
            destructive: true,
            onPress: () => void decide('ARCHIVED', t('mobile.expiry.record.archived')),
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setArchiving(false)}
      />
      <LeaveSheet guard={leaving} />
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
      {change.kind === 'CREATE' ? (
        <IconTile color={colors.successSoft}>
          <Plus size={20} strokeWidth={2.2} color={colors.success} />
        </IconTile>
      ) : (
        <IconTile color={colors.secondary}>
          <PencilLine size={20} strokeWidth={2} color={colors.link} />
        </IconTile>
      )}
      <View style={styles.grow}>
        <Text style={type.row}>
          {change.kind === 'CREATE'
            ? t('mobile.expiry.record.created')
            : t('mobile.expiry.record.changed')}
        </Text>
        {change.kind === 'CREATE' || lines.length === 0 ? (
          <Text style={[type.secondary, tabular]}>
            {t('mobile.expiry.record.counts', {
              floor: formatQty(change.qtyFloorNew),
              warehouse: formatQty(change.qtyWarehouseNew),
            })}
          </Text>
        ) : (
          lines.map((line) => (
            <Text key={line} style={[type.secondary, tabular]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 1 },
  body: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  top: { gap: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stats: { flexDirection: 'row', gap: 10 },
  // The kit's stat tile, grey and flat inside a card.
  stat: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.canvas,
  },
  facts: { gap: spacing.xs },
  card: { gap: spacing.sm },
  head: { marginTop: 0 },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  // A group's row in size, without its two-line limit.
  liability: {
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    gap: 1,
  },
  loading: { marginTop: spacing.md },
  historyProblem: { marginTop: 0 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  barProblem: { marginTop: 0 },
});
