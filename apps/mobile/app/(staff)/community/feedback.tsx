import { ENGAGEMENT_LIMITS, FEEDBACK_CATEGORIES } from '@tugeel/shared/hr';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { MessageSquareText, Plus, Reply, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type Feedback, useMyFeedback, useSendFeedback } from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad, useAt } from '../../../src/community/parts';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, Toggle } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { Card, FooterBar, PAGE, Pill, type Tone } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const STATUS_TONES: Record<Feedback['status'], Tone> = { NEW: 'info', SEEN: 'warn', DONE: 'ok' };

/** The form: the category, a title, the text and «Нэргүй илгээх», which says what it costs. */
function NewFeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const send = useSendFeedback();
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [category, setCategory] = useState<Feedback['category']>('SUGGESTION');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const submit = async () => {
    setProblem(null);
    try {
      await send.mutateAsync({
        key,
        body: { category, title: title.trim(), body: body.trim(), anonymous },
      });
      toast.show({
        message: t(
          anonymous ? 'mobile.community.feedback.sentAnonymous' : 'mobile.community.feedback.sent',
        ),
      });
      setKey(Crypto.randomUUID());
      setCategory('SUGGESTION');
      setTitle('');
      setBody('');
      setAnonymous(false);
      onClose();
    } catch (failure) {
      setProblem(problemFrom(failure));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('mobile.community.close')}
      header={
        <SheetHeader
          title={t('mobile.community.feedback.new')}
          right={<SheetClose label={t('mobile.community.close')} onPress={onClose} />}
        />
      }
      footer={
        <PillButton
          title={t('mobile.community.feedback.send')}
          icon={<Send size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
          disabled={title.trim() === '' || body.trim() === ''}
          loading={send.isPending}
          onPress={() => void submit()}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={type.label}>{t('mobile.community.feedback.category')}</Text>
        <View style={styles.chips}>
          {FEEDBACK_CATEGORIES.map((entry) => (
            <ChoiceChip
              key={entry}
              label={t(`mobile.community.feedback.categories.${entry}`)}
              selected={category === entry}
              onWhite
              onPress={() => setCategory(entry)}
            />
          ))}
        </View>
        <TextField
          label={t('mobile.community.feedback.titleLabel')}
          value={title}
          onChangeText={setTitle}
          maxLength={ENGAGEMENT_LIMITS.maxTitle}
        />
        <TextField
          label={t('mobile.community.feedback.body')}
          value={body}
          onChangeText={setBody}
          maxLength={ENGAGEMENT_LIMITS.maxBody}
          multiline
        />
        <View style={styles.switchRow}>
          <Text style={[type.row, styles.grow]}>{t('mobile.community.feedback.anonymous')}</Text>
          <Toggle
            value={anonymous}
            onChange={setAnonymous}
            label={t('mobile.community.feedback.anonymous')}
          />
        </View>
        <Text style={type.secondary}>{t('mobile.community.feedback.anonymousHint')}</Text>
        <ProblemText problem={problem} />
      </ScrollView>
    </Sheet>
  );
}

/**
 * «Санал хүсэлт» (ADR-0146): what the person sent under their name, with HR's reply and status, and
 * the form to send a new one. An anonymous one carries no name, so it is not listed afterwards.
 */
export default function FeedbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const at = useAt();
  const feedback = useMyFeedback();
  const [open, setOpen] = useState(false);

  const renderFeedback = ({ item }: { item: Feedback }) => (
    <Card style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={[type.rowStrong, styles.grow]} numberOfLines={2}>
          {item.title}
        </Text>
        <Pill
          label={t(`mobile.community.feedback.status.${item.status}`)}
          tone={STATUS_TONES[item.status]}
        />
      </View>
      <Text style={[type.secondary, tabular]}>
        {`${t(`mobile.community.feedback.categories.${item.category}`)} · ${at(item.createdAt)}`}
      </Text>
      <Text style={[type.body, styles.text]}>{item.body}</Text>
      {item.reply ? (
        <View style={styles.reply}>
          <View style={styles.replyHead}>
            <Reply size={14} strokeWidth={2.2} color={colors.link} />
            <Text style={styles.replyTitle}>{t('mobile.community.feedback.reply')}</Text>
          </View>
          <Text style={type.body}>{item.reply}</Text>
        </View>
      ) : null}
    </Card>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.feedback.title')} onBack={() => router.back()} />
      <FlatList
        style={styles.flex}
        data={feedback.data ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderFeedback}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={feedback.isRefetching}
            onRefresh={() => void feedback.refetch()}
          />
        }
        ListEmptyComponent={
          <FirstLoad query={feedback}>
            <EmptyState
              icon={<MessageSquareText size={40} strokeWidth={1.5} color={colors.muted} />}
              title={t('mobile.community.feedback.empty')}
              hint={t('mobile.community.feedback.emptyHint')}
            />
          </FirstLoad>
        }
      />
      <FooterBar>
        <PillButton
          style={styles.flex}
          title={t('mobile.community.feedback.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          onPress={() => setOpen(true)}
        />
      </FooterBar>
      <NewFeedbackSheet visible={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  list: { padding: PAGE.padding },
  row: { gap: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  text: { color: colors.label2 },
  reply: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.field,
    backgroundColor: colors.secondary,
  },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  replyTitle: { ...type.secondary, fontFamily: fonts.semibold, color: colors.link },
  separator: { height: PAGE.gap },
  form: { padding: spacing.lg, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
