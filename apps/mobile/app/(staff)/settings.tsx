import { useRouter } from 'expo-router';
import { ChevronDown, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { problemFrom } from '../../src/api/problem';
import { useRepContext } from '../../src/api/rep';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../src/theme/tokens';
import { Group, IconTile, ICON_INSET, Row } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { FootNote, NavBar, Page, SectionHeader } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';

/**
 * «Захиалга илгээх тохиргоо» (the OrderSettings board, ADR-0061 #6, ADR-0068): the board (with its
 * branch), its pipeline and the stage new orders land on, among those the rep may place on; a
 * CONFIRM stage reserves at once, a NONE stage leaves a draft. Choosing a board or a pipeline takes
 * its first stage, so the next order always has a place.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const context = useRepContext();
  const { stageId, setStageId, pending } = useShop();
  const [choosingPipeline, setChoosingPipeline] = useState(false);
  const boards = context.data?.boards ?? [];
  const board =
    boards.find((entry) =>
      entry.pipelines.some((pipeline) => pipeline.stages.some((stage) => stage.id === stageId)),
    ) ?? null;
  const pipeline =
    board?.pipelines.find((entry) => entry.stages.some((stage) => stage.id === stageId)) ?? null;
  const stage = pipeline?.stages.find((entry) => entry.id === stageId) ?? null;
  const locked = pending !== null;
  const firstStage = (pipelineId: number) =>
    boards.flatMap((entry) => entry.pipelines).find((entry) => entry.id === pipelineId)?.stages[0]
      ?.id ?? null;

  return (
    <Page>
      <NavBar back={t('mobile.tabs.profile')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text accessibilityRole="header" style={[type.title2, styles.title]}>
          {t('mobile.settings.title')}
        </Text>
        <Text style={[type.body, styles.hint]}>{t('mobile.settings.hint')}</Text>
        {context.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : null}
        {context.error ? <ProblemText problem={problemFrom(context.error)} /> : null}
        {context.data && boards.length === 0 ? (
          <EmptyState title={t('mobile.settings.none')} hint={t('mobile.settings.noneHint')} />
        ) : null}

        {boards.length > 0 ? (
          <>
            <SectionHeader style={styles.section}>{t('mobile.settings.board')}</SectionHeader>
            <Group>
              {boards.map((entry) => (
                <Row
                  key={entry.id}
                  title={entry.name}
                  subtitle={entry.branchName}
                  role="radio"
                  checked={entry.id === board?.id}
                  chevron={false}
                  disabled={locked}
                  minHeight={56}
                  onPress={() => {
                    const first = entry.pipelines[0];
                    const next = first ? firstStage(first.id) : null;
                    if (next !== null) setStageId(next);
                  }}
                />
              ))}
            </Group>
          </>
        ) : null}

        {board ? (
          <>
            <SectionHeader style={styles.section}>{t('mobile.settings.pipeline')}</SectionHeader>
            <Group>
              <Row
                title={pipeline?.name ?? t('common.none')}
                chevron={false}
                right={
                  board.pipelines.length > 1 ? (
                    <ChevronDown size={16} strokeWidth={2.6} color={colors.input} />
                  ) : null
                }
                disabled={locked || board.pipelines.length < 2}
                minHeight={50}
                onPress={() => setChoosingPipeline(true)}
              />
            </Group>
          </>
        ) : null}

        {pipeline ? (
          <>
            <SectionHeader style={styles.section}>{t('mobile.settings.stage')}</SectionHeader>
            <Group inset={ICON_INSET}>
              {pipeline.stages.map((entry, index) => (
                <Row
                  key={entry.id}
                  icon={
                    <IconTile
                      color={entry.action === 'CONFIRM' ? colors.tint.blue : colors.tint.gray}
                    >
                      <Text style={styles.mark}>{String(index + 1)}</Text>
                    </IconTile>
                  }
                  title={entry.name}
                  subtitle={t(
                    entry.action === 'CONFIRM'
                      ? 'mobile.settings.confirms'
                      : 'mobile.settings.drafts',
                  )}
                  role="radio"
                  checked={entry.id === stageId}
                  chevron={false}
                  disabled={locked}
                  minHeight={64}
                  onPress={() => setStageId(entry.id)}
                />
              ))}
            </Group>
          </>
        ) : null}

        <View style={styles.summary}>
          <Send size={20} strokeWidth={2} color={colors.link} />
          <View style={styles.grow}>
            <Text style={styles.summaryLabel}>{t('mobile.settings.next')}</Text>
            <Text style={styles.summaryValue}>
              {pipeline && stage
                ? `${pipeline.name} › ${stage.name}`
                : t('mobile.settings.notChosen')}
            </Text>
          </View>
        </View>
        <FootNote>{t('mobile.settings.footer')}</FootNote>
      </ScrollView>

      <ActionSheet
        visible={choosingPipeline}
        title={t('mobile.settings.pipeline')}
        actions={(board?.pipelines ?? []).map((entry) => ({
          label: entry.name,
          onPress: () => {
            setChoosingPipeline(false);
            const next = firstStage(entry.id);
            if (next !== null) setStageId(next);
          },
        }))}
        cancelLabel={t('common.cancel')}
        onCancel={() => setChoosingPipeline(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  hint: { marginTop: 6, marginHorizontal: spacing.xs, color: colors.muted },
  loading: { marginTop: spacing.xl },
  section: { marginTop: 22 },
  mark: { ...type.chip, fontFamily: fonts.bold, color: colors.primaryForeground },
  summary: {
    marginTop: 22,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.secondary,
  },
  grow: { flex: 1 },
  summaryLabel: { ...type.secondary, color: colors.link },
  summaryValue: type.heading,
});
