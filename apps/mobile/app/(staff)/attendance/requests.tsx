import { PUNCH_GROUPS, WORKFORCE_LIMITS } from '@tugeel/shared/hr';
import { addDays } from '@tugeel/shared/time';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardList, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type RequestType,
  type TimeRequest,
  type TimeRequestCreate,
  useCancelRequest,
  useMyAttendance,
  useMyRequests,
  useRequestTypes,
  useSendRequest,
} from '../../../src/api/attendance';
import { problemFrom } from '../../../src/api/problem';
import { monthOf, shortDate, ubDate, ubTime } from '../../../src/dates/dates';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { MonthCalendar } from '../../../src/ui/calendar';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { EmptyState, ProblemText, useProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const STATUS_COLORS: Record<TimeRequest['status'], { background: string; text: string }> = {
  PENDING: { background: colors.warningSoft, text: colors.warning },
  APPROVED: { background: colors.successSoft, text: colors.success },
  REJECTED: { background: colors.destructiveSoft, text: colors.destructiveText },
  CANCELLED: { background: colors.fill, text: colors.muted },
};

/** An Ulaanbaatar date and wall-clock time as an instant (UTC+8, no daylight saving). */
function ubInstant(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00+08:00`)).toISOString();
}

/** «11-04 – 11-06», «11-04 09:00–12:00» or «11-04 Ирсэн 08:55». */
function useWhen() {
  const { t } = useTranslation();
  return (request: TimeRequest): string => {
    if (request.punchKind && request.startsAt) {
      return `${shortDate(request.fromDate)} ${t(`mobile.requests.punch.${request.punchKind}`)} ${ubTime(request.startsAt)}`;
    }
    if (request.startsAt && request.endsAt) {
      return `${shortDate(request.fromDate)} ${ubTime(request.startsAt)}–${ubTime(request.endsAt)}`;
    }
    return request.fromDate === request.toDate
      ? shortDate(request.fromDate)
      : `${shortDate(request.fromDate)} – ${shortDate(request.toDate)}`;
  };
}

/** The form in a sheet: the type, then the dates, the hours or the punch, and a note. */
function NewRequestSheet(props: { visible: boolean; today: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const problemText = useProblemText();
  const types = useRequestTypes();
  const send = useSendRequest();
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [chosen, setChosen] = useState<RequestType | null>(null);
  const [from, setFrom] = useState(props.today);
  const [to, setTo] = useState(props.today);
  const [month, setMonth] = useState(monthOf(props.today));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [punchKind, setPunchKind] = useState<'IN' | 'OUT'>('IN');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const punch = chosen ? PUNCH_GROUPS.includes(chosen.group) : false;
  const sentNow = chosen?.group === 'PUNCH_SENT';
  const ranged = chosen?.wholeDays === true && !punch;
  const active = (types.data ?? []).filter((entry) => entry.active);

  const reset = () => {
    setKey(Crypto.randomUUID());
    setChosen(null);
    setFrom(props.today);
    setTo(props.today);
    setNote('');
    setError(null);
  };
  const pick = (date: string) => {
    if (!ranged) {
      setFrom(date);
      setTo(date);
      return;
    }
    // A range: the first tap starts it, the second ends it (a tap before the start restarts).
    if (from !== to || date < from) {
      setFrom(date);
      setTo(date);
    } else {
      setTo(date);
    }
  };
  const submit = async () => {
    if (!chosen) return;
    if (!punch && !ranged && (!TIME.test(start) || !TIME.test(end) || end <= start)) {
      setError(t('mobile.requests.badHours'));
      return;
    }
    if (punch && !sentNow && !TIME.test(start)) {
      setError(t('mobile.requests.badHours'));
      return;
    }
    setError(null);
    const base = { typeId: chosen.id, fromDate: from, note: note.trim() || null };
    const body: TimeRequestCreate = punch
      ? { ...base, punchKind, startsAt: sentNow ? null : ubInstant(from, start) }
      : ranged
        ? { ...base, toDate: to }
        : { ...base, startsAt: ubInstant(from, start), endsAt: ubInstant(from, end) };
    try {
      await send.mutateAsync({ key, body });
      toast.show({ message: t('mobile.requests.sent') });
      reset();
      props.onClose();
    } catch (failure) {
      setError(problemText(problemFrom(failure)));
    }
  };

  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      closeLabel={t('mobile.requests.close')}
      header={
        <SheetHeader
          title={t('mobile.requests.new')}
          right={<SheetClose label={t('mobile.requests.close')} onPress={props.onClose} />}
        />
      }
      footer={
        <PillButton
          title={t('mobile.requests.send')}
          disabled={!chosen}
          loading={send.isPending}
          onPress={() => void submit()}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={type.label}>{t('mobile.requests.type')}</Text>
        {types.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.chips}>
          {active.map((entry) => (
            <ChoiceChip
              key={entry.id}
              label={entry.name}
              selected={chosen?.id === entry.id}
              onWhite
              onPress={() => {
                setChosen(entry);
                setError(null);
                if (!(entry.wholeDays && !PUNCH_GROUPS.includes(entry.group))) setTo(from);
              }}
            />
          ))}
        </View>
        {chosen && !sentNow ? (
          <>
            <Text style={type.label}>
              {ranged
                ? t('mobile.requests.range', {
                    from: shortDate(from),
                    to: shortDate(to),
                  })
                : t('mobile.requests.day', { date: shortDate(from) })}
            </Text>
            <MonthCalendar
              month={month}
              onMonth={setMonth}
              today={props.today}
              value={ranged ? { from, to } : from}
              min={addDays(props.today, -WORKFORCE_LIMITS.maxRequestDays)}
              max={punch ? props.today : addDays(props.today, WORKFORCE_LIMITS.maxRequestDays)}
              onPick={pick}
            />
          </>
        ) : null}
        {chosen && punch ? (
          <>
            <Segmented
              label={t('mobile.requests.punchKind')}
              options={[
                { value: 'IN', label: t('mobile.requests.punch.IN') },
                { value: 'OUT', label: t('mobile.requests.punch.OUT') },
              ]}
              value={punchKind}
              onChange={setPunchKind}
            />
            {sentNow ? (
              <Text style={type.secondary}>{t('mobile.requests.sentNow')}</Text>
            ) : (
              <TextField
                label={t('mobile.requests.time')}
                value={start}
                onChangeText={setStart}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                placeholder="09:00"
              />
            )}
          </>
        ) : null}
        {chosen && !punch && !ranged ? (
          <View style={styles.times}>
            <TextField
              style={styles.grow}
              label={t('mobile.requests.start')}
              value={start}
              onChangeText={setStart}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="09:00"
            />
            <TextField
              style={styles.grow}
              label={t('mobile.requests.end')}
              value={end}
              onChangeText={setEnd}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="13:00"
            />
          </View>
        ) : null}
        {chosen ? (
          <TextField
            label={t('mobile.requests.note')}
            value={note}
            onChangeText={setNote}
            maxLength={WORKFORCE_LIMITS.maxRequestNote}
            multiline
          />
        ) : null}
        {error ? <Text style={[type.secondary, styles.error]}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

/**
 * «Цагийн хүсэлт» (ADR-0144): the person's own requests newest first — the type, when, the status
 * and HR's note — with «Хүсэлт илгээх» opening the form and «Цуцлах» on a pending one. HR decides
 * them on the web; an approved missed punch becomes the punch.
 */
export default function RequestsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ today?: string }>();
  const me = useMyAttendance();
  const requests = useMyRequests();
  const cancel = useCancelRequest();
  const when = useWhen();
  const [open, setOpen] = useState(false);
  const today = params.today ?? me.data?.today ?? (me.data ? ubDate(me.data.now) : null);
  const rows = useMemo(
    () => [...(requests.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [requests.data],
  );

  const renderRequest = ({ item }: { item: TimeRequest }) => {
    const palette = STATUS_COLORS[item.status];
    return (
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: item.color }]} />
        <View style={styles.grow}>
          <Text style={type.rowStrong} numberOfLines={1}>
            {item.typeName}
          </Text>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {when(item)}
          </Text>
          {item.decisionNote ? (
            <Text style={type.secondary} numberOfLines={2}>
              {item.decisionNote}
            </Text>
          ) : null}
        </View>
        <View style={styles.end}>
          <View style={[styles.pill, { backgroundColor: palette.background }]}>
            <Text style={[styles.pillText, { color: palette.text }]}>
              {t(`mobile.requests.status.${item.status}`)}
            </Text>
          </View>
          {item.status === 'PENDING' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.requests.cancelFor', { name: item.typeName })}
              hitSlop={8}
              onPress={() =>
                void cancel
                  .mutateAsync(item.id)
                  .then(() => toast.show({ message: t('mobile.requests.cancelled') }))
                  .catch(() => toast.show({ message: t('mobile.requests.cancelFailed') }))
              }
            >
              <Text style={styles.cancel}>{t('mobile.requests.cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.requests.title')} onBack={() => router.back()} right={null} />
      <FlatList
        data={rows}
        keyExtractor={(request) => String(request.id)}
        renderItem={renderRequest}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 72 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={requests.isRefetching}
            onRefresh={() => void requests.refetch()}
          />
        }
        ListEmptyComponent={
          requests.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : requests.error ? (
            <ProblemText problem={problemFrom(requests.error)} />
          ) : (
            <EmptyState
              icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.requests.empty')}
            />
          )
        }
      />
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={t('mobile.requests.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          disabled={today === null}
          onPress={() => setOpen(true)}
        />
      </View>
      {today ? (
        <NewRequestSheet visible={open} today={today} onClose={() => setOpen(false)} />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 2 },
  list: { paddingHorizontal: 14, paddingTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  end: { alignItems: 'flex-end', gap: 6 },
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  cancel: { ...type.secondary, color: colors.destructiveText, fontFamily: fonts.semibold },
  separator: { height: spacing.sm },
  loading: { marginTop: spacing.xl },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
  form: { padding: spacing.lg, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  times: { flexDirection: 'row', gap: spacing.md },
  error: { color: colors.destructiveText },
});
