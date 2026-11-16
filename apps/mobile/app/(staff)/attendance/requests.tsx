import { PUNCH_GROUPS, WORKFORCE_LIMITS } from '@tugeel/shared/hr';
import { addDays } from '@tugeel/shared/time';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  ClipboardList,
  Clock,
  Hourglass,
  type LucideIcon,
  Plus,
  Send,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { MonthCalendar } from '../../../src/ui/calendar';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { EmptyState, ProblemText, useProblemText } from '../../../src/ui/kit';
import { Group, ICON_INSET, IconTile } from '../../../src/ui/grouped';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { FooterBar, PAGE, Pill, type Tone, TONES } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Each status's tone and the sign on its tile. */
const STATUS_LOOK: Record<TimeRequest['status'], { tone: Tone; Icon: LucideIcon }> = {
  PENDING: { tone: 'warn', Icon: Hourglass },
  APPROVED: { tone: 'ok', Icon: CircleCheck },
  REJECTED: { tone: 'bad', Icon: CircleX },
  CANCELLED: { tone: 'neutral', Icon: CircleMinus },
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
          icon={<Send size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
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
                icon={Clock}
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
              style={styles.half}
              label={t('mobile.requests.start')}
              icon={Clock}
              value={start}
              onChangeText={setStart}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="09:00"
            />
            <TextField
              style={styles.half}
              label={t('mobile.requests.end')}
              icon={Clock}
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
        {error ? <Text style={[type.body, styles.error]}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

/**
 * «Цагийн хүсэлт» (ADR-0144): the person's own requests newest first, those waiting over those
 * decided — the type, when, the status and HR's note — with «Хүсэлт илгээх» opening the form and
 * «Цуцлах» on a pending one. HR decides them on the web; an approved missed punch becomes the punch.
 */
export default function RequestsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
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
  const pending = rows.filter((request) => request.status === 'PENDING');
  const decided = rows.filter((request) => request.status !== 'PENDING');

  const renderRequest = (item: TimeRequest) => {
    const { tone, Icon } = STATUS_LOOK[item.status];
    const palette = TONES[tone];
    const faded = item.status === 'CANCELLED';
    return (
      <View key={item.id} style={styles.row}>
        <IconTile color={palette.background}>
          <Icon size={18} strokeWidth={2.2} color={faded ? colors.label2 : palette.text} />
        </IconTile>
        <View style={styles.grow}>
          <View style={styles.head}>
            <Text style={[type.rowStrong, styles.name, faded && styles.muted]} numberOfLines={1}>
              {item.typeName}
            </Text>
            <Pill
              label={t(`mobile.requests.status.${item.status}`)}
              tone={tone}
              style={styles.pill}
            />
          </View>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {when(item)}
          </Text>
          {item.decisionNote ? (
            <Text style={[type.secondary, styles.note]} numberOfLines={2}>
              {item.decisionNote}
            </Text>
          ) : null}
          {item.status === 'PENDING' ? (
            <PillButton
              title={t('mobile.requests.cancel')}
              accessibilityLabel={t('mobile.requests.cancelFor', { name: item.typeName })}
              variant="destructive"
              height={36}
              style={styles.cancel}
              onPress={() =>
                void cancel
                  .mutateAsync(item.id)
                  .then(() => toast.show({ message: t('mobile.requests.cancelled') }))
                  .catch(() => toast.show({ message: t('mobile.requests.cancelFailed') }))
              }
            />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.requests.title')} onBack={() => router.back()} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={requests.isRefetching}
            onRefresh={() => void requests.refetch()}
          />
        }
      >
        {rows.length === 0 ? (
          requests.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : requests.error ? (
            <ProblemText problem={problemFrom(requests.error)} style={styles.problem} />
          ) : (
            <EmptyState
              icon={<ClipboardList size={40} strokeWidth={1.5} color={colors.muted} />}
              title={t('mobile.requests.empty')}
            />
          )
        ) : null}
        {pending.length > 0 ? (
          <>
            <SectionHeader style={styles.section}>
              {t('mobile.requests.status.PENDING')}
            </SectionHeader>
            <Group inset={ICON_INSET}>{pending.map(renderRequest)}</Group>
          </>
        ) : null}
        {decided.length > 0 ? (
          <>
            <SectionHeader style={styles.section}>{t('mobile.requests.decided')}</SectionHeader>
            <Group inset={ICON_INSET}>{decided.map(renderRequest)}</Group>
          </>
        ) : null}
      </ScrollView>
      <FooterBar>
        <PillButton
          style={styles.flex}
          title={t('mobile.requests.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          disabled={today === null}
          onPress={() => setOpen(true)}
        />
      </FooterBar>
      {today ? (
        <NewRequestSheet visible={open} today={today} onClose={() => setOpen(false)} />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  half: { flex: 1, minWidth: 0 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  body: { padding: PAGE.padding, gap: PAGE.gap },
  /** A label sits 16 px under the block above it and 8 px over its own list. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, minWidth: 0 },
  pill: { alignSelf: 'center' },
  note: { color: colors.label2 },
  cancel: { alignSelf: 'flex-start', marginTop: spacing.xs, paddingHorizontal: spacing.lg },
  muted: { color: colors.muted },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: 0 },
  form: { padding: spacing.lg, gap: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  times: { flexDirection: 'row', gap: spacing.md },
  error: { color: colors.destructive },
});
