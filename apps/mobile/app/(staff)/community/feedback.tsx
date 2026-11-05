import { ENGAGEMENT_LIMITS, FEEDBACK_CATEGORIES } from '@tugeel/shared/hr';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { MessageSquareText, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Feedback, useMyFeedback, useSendFeedback } from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad, StatusPill, useAt } from '../../../src/community/parts';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, Toggle } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

const STATUS: Record<Feedback['status'], { background: string; color: string }> = {
  NEW: { background: colors.secondary, color: colors.link },
  SEEN: { background: colors.warningSoft, color: colors.warning },
  DONE: { background: colors.successSoft, color: colors.success },
};

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
  const insets = useSafeAreaInsets();
  const at = useAt();
  const feedback = useMyFeedback();
  const [open, setOpen] = useState(false);

  const renderFeedback = ({ item }: { item: Feedback }) => (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={[type.rowStrong, styles.grow]} numberOfLines={2}>
          {item.title}
        </Text>
        <StatusPill
          label={t(`mobile.community.feedback.status.${item.status}`)}
          background={STATUS[item.status].background}
          color={STATUS[item.status].color}
        />
      </View>
      <Text style={type.secondary}>
        {`${t(`mobile.community.feedback.categories.${item.category}`)} · ${at(item.createdAt)}`}
      </Text>
      <Text style={type.body}>{item.body}</Text>
      {item.reply ? (
        <View style={styles.reply}>
          <Text style={styles.replyHead}>{t('mobile.community.feedback.reply')}</Text>
          <Text style={type.body}>{item.reply}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.feedback.title')}
        onBack={() => router.back()}
        right={null}
      />
      <FlatList
        data={feedback.data ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderFeedback}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 72 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={feedback.isRefetching}
            onRefresh={() => void feedback.refetch()}
          />
        }
        ListEmptyComponent={
          <FirstLoad query={feedback}>
            <EmptyState
              icon={<MessageSquareText size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.community.feedback.empty')}
              hint={t('mobile.community.feedback.emptyHint')}
            />
          </FirstLoad>
        }
      />
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={t('mobile.community.feedback.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          onPress={() => setOpen(true)}
        />
      </View>
      <NewFeedbackSheet visible={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  list: { paddingHorizontal: 14, paddingTop: spacing.md },
  row: {
    gap: 6,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reply: {
    marginTop: spacing.xs,
    padding: spacing.md,
    gap: 2,
    borderRadius: radii.field,
    backgroundColor: colors.secondary,
  },
  replyHead: { ...type.secondary, fontFamily: fonts.semibold, color: colors.link },
  separator: { height: spacing.sm },
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
