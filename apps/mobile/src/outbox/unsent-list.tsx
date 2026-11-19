import { useRouter } from 'expo-router';
import { CircleAlert, Clock, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { monthDay } from '../dates/calendar';
import { ubDate, ubTime } from '../dates/dates';
import { formatMnt } from '../format/format';
import { useOutbox } from '../state/outbox';
import { useShop } from '../state/shop';
import { colors, spacing, tabular, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Group, Row, Separator } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { SectionHeader } from '../ui/layout';
import { ActionSheet, Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Card, Notice, Pill, type Tone } from '../ui/staff-kit';
import { Text } from '../ui/text';
import {
  cartHasContent,
  DAMAGED,
  KEY_TOO_OLD,
  mayDelete,
  mayEdit,
  type OutboxEntry,
  type OutboxStatus,
} from './entry';
import { STUCK } from './known';

const TONES: Record<Exclude<OutboxStatus, 'sent'>, Tone> = {
  waiting: 'neutral',
  sending: 'info',
  refused: 'bad',
  check: 'warn',
};

/** «11/19 14:05»: when the rep wrote it, in Ulaanbaatar. */
const writtenText = (iso: string) => `${monthDay(ubDate(iso))} ${ubTime(iso)}`;

/** The store's name, or its id for a send taken over without its cart. */
function useStoreName() {
  const { t } = useTranslation();
  return (entry: OutboxEntry) =>
    entry.summary.storeName ?? t('mobile.outbox.unknownStore', { id: entry.summary.customerId });
}

/** One unsent order: the store, «N бараа · when written», and its state as a pill. */
function UnsentRow({ entry, onPress }: { entry: OutboxEntry; onPress: () => void }) {
  const { t } = useTranslation();
  const storeName = useStoreName();
  const status = entry.status === 'sent' ? 'waiting' : entry.status;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text style={type.rowStrong} numberOfLines={1}>
          {storeName(entry)}
        </Text>
        <Text style={[type.caption, tabular]} numberOfLines={1}>
          {[
            t('mobile.cart.count', { n: entry.summary.lineCount }),
            entry.summary.estimate
              ? t('mobile.orders.approx', {
                  amount: t('pricing.money', { amount: formatMnt(entry.summary.estimate) }),
                })
              : null,
            entry.summary.unpricedLines
              ? t('mobile.offlineData.unpriced', { n: entry.summary.unpricedLines })
              : null,
            writtenText(entry.writtenAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {entry.resent ? (
          <Text style={[type.caption, styles.resent]} numberOfLines={2}>
            {t('mobile.outbox.resent')}
          </Text>
        ) : null}
      </View>
      <Pill label={t(`mobile.outbox.status.${status}`)} tone={TONES[status]} />
    </Pressable>
  );
}

/**
 * «Илгээгдээгүй (N)» at the top of «Миний захиалгууд» (owner 2026-11-19): the outbox's unsent
 * orders from the phone, even when the server's list cannot load, «Одоо илгээх», and a row opens
 * its sheet (the reason of a refusal, «Засах», «Устгах»). Nothing when every order is on the server.
 */
export function UnsentSection() {
  const { t } = useTranslation();
  const { unsent, running, sendNow, readFailed, writeFailed } = useOutbox();
  const [opened, setOpened] = useState<string | null>(null);
  if (unsent.length === 0 && !readFailed && !writeFailed) return null;
  const entry = unsent.find((one) => one.id === opened) ?? null;
  const waiting = unsent.some((one) => one.status === 'waiting');
  return (
    <View style={styles.section}>
      <SectionHeader style={styles.header}>
        {t('mobile.outbox.section', { n: unsent.length })}
      </SectionHeader>
      {readFailed ? (
        <Notice tone="bad" icon={CircleAlert}>
          {t('mobile.outbox.readFailed')}
        </Notice>
      ) : null}
      {writeFailed ? (
        <Notice tone="bad" icon={CircleAlert}>
          {t('mobile.outbox.writeFailed')}
        </Notice>
      ) : null}
      {unsent.length > 0 ? (
        <Card flush>
          {unsent.map((one, index) => (
            <View key={one.id}>
              {index > 0 ? <Separator /> : null}
              <UnsentRow entry={one} onPress={() => setOpened(one.id)} />
            </View>
          ))}
        </Card>
      ) : null}
      {waiting || running ? (
        <PillButton
          title={t('mobile.outbox.sendNow')}
          variant="soft"
          height={44}
          loading={running}
          loadingTitle={t('mobile.outbox.status.sending')}
          icon={<Send size={16} strokeWidth={2.2} color={colors.link} />}
          onPress={() => void sendNow()}
        />
      ) : null}
      <EntrySheet entry={entry} onClose={() => setOpened(null)} />
    </View>
  );
}

/** An unsent order opened: what it holds, why it waits or was refused, and what the rep may do. */
function EntrySheet({ entry, onClose: close }: { entry: OutboxEntry | null; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const storeName = useStoreName();
  const { remove, edit } = useOutbox();
  const { cart } = useShop();
  const [asking, setAsking] = useState<'none' | 'delete' | 'replace'>('none');
  const [failed, setFailed] = useState(false);
  const onClose = () => {
    setFailed(false);
    close();
  };
  const shown = entry;

  const goEdit = async () => {
    if (!shown) return;
    setAsking('none');
    if (await edit(shown.id)) {
      setFailed(false);
      onClose();
      router.navigate('/cart');
    } else {
      setFailed(true);
    }
  };

  const summary = shown?.summary;
  const days = summary?.deliveryDate ? monthDay(summary.deliveryDate) : t('common.none');
  return (
    <>
      <Sheet
        visible={shown !== null && asking === 'none'}
        onClose={onClose}
        closeLabel={t('common.close')}
        fit
        header={
          <SheetHeader
            title={shown ? storeName(shown) : ''}
            right={<SheetClose onPress={onClose} label={t('common.close')} />}
          />
        }
      >
        {shown && summary ? (
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {failed ? (
              <Notice tone="bad" icon={CircleAlert}>
                {t('mobile.outbox.notStoredHere')}
              </Notice>
            ) : null}
            {shown.status === 'refused' ? (
              <>
                <Text style={[type.rowStrong, styles.refused]}>
                  {t('mobile.outbox.refusedTitle')}
                </Text>
                <ProblemText problem={shown.problem} style={styles.problem} />
              </>
            ) : shown.status === 'check' ? (
              <Notice tone="warn" icon={CircleAlert}>
                {shown.problem?.code === DAMAGED
                  ? t('mobile.outbox.damagedHint')
                  : shown.problem?.code === STUCK
                    ? t('mobile.outbox.stuckHint')
                    : shown.problem?.code === KEY_TOO_OLD
                      ? t('mobile.outbox.checkOldHint')
                      : t('mobile.outbox.checkHint')}
              </Notice>
            ) : (
              <Notice tone="info" icon={Clock}>
                {shown.status === 'sending'
                  ? t('mobile.outbox.sendingHint')
                  : shown.resent
                    ? t('mobile.outbox.resent')
                    : t('mobile.outbox.waitingHint')}
              </Notice>
            )}
            <Group>
              <Row
                title={t('mobile.cart.count', { n: summary.lineCount })}
                subtitle={summary.firstNames.length > 0 ? summary.firstNames.join(', ') : null}
              />
              <Row title={t(`sales.fulfilments.${summary.fulfilment}`)} value={days} />
              <Row
                title={t('mobile.checkout.payment')}
                value={t(`sales.paymentMethods.${summary.paymentMethod}`)}
              />
              {summary.stageName ? (
                <Row title={t('mobile.home.stage')} value={summary.stageName} />
              ) : null}
              <Row title={t('mobile.outbox.written')} value={writtenText(shown.writtenAt)} />
            </Group>
            {mayEdit(shown) ? (
              <PillButton
                title={t('common.edit')}
                height={48}
                onPress={() => {
                  if (cartHasContent(cart)) setAsking('replace');
                  else void goEdit();
                }}
              />
            ) : null}
            {mayDelete(shown) ? (
              <PillButton
                title={t('common.delete')}
                variant="soft"
                height={48}
                onPress={() => setAsking('delete')}
              />
            ) : null}
          </ScrollView>
        ) : (
          <View />
        )}
      </Sheet>
      <ActionSheet
        visible={shown !== null && asking === 'delete'}
        title={t('mobile.outbox.deleteTitle')}
        message={t('mobile.outbox.deleteHint')}
        actions={[
          {
            label: t('common.delete'),
            destructive: true,
            onPress: () => {
              setAsking('none');
              if (shown) {
                void remove(shown.id).then((gone) => {
                  setFailed(!gone);
                  if (gone) onClose();
                });
              }
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setAsking('none')}
      />
      <ActionSheet
        visible={shown !== null && asking === 'replace'}
        title={t('mobile.outbox.replaceTitle')}
        message={t('mobile.outbox.replaceHint')}
        actions={[{ label: t('mobile.outbox.replace'), onPress: () => void goEdit() }]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setAsking('none')}
      />
    </>
  );
}

/** «Нүүр»'s one line (owner 2026-11-19): «Илгээгдээгүй N захиалга», opening «Миний захиалгууд». */
export function UnsentLine({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { unsent } = useOutbox();
  if (unsent.length === 0) return null;
  const refused = unsent.some((one) => one.status === 'refused' || one.status === 'check');
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={t('mobile.outbox.homeLine', { n: unsent.length })}
      style={[styles.line, style]}
    >
      {refused ? (
        <CircleAlert size={18} strokeWidth={2} color={colors.destructive} />
      ) : (
        <Clock size={18} strokeWidth={2} color={colors.warning} />
      )}
      <Text style={[type.rowStrong, styles.grow]} numberOfLines={1}>
        {t('mobile.outbox.homeLine', { n: unsent.length })}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  header: { marginTop: 0, marginBottom: 0 },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.accent },
  text: { flex: 1, minWidth: 0, gap: 2 },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  refused: { color: colors.destructive },
  resent: { color: colors.warningText },
  problem: { marginTop: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
});
