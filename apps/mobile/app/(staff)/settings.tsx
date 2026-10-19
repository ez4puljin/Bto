import { useRouter } from 'expo-router';
import {
  Check,
  ChevronDown,
  CircleCheck,
  FilePenLine,
  Lock,
  MapPin,
  PackageCheck,
  SquareKanban,
  TriangleAlert,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { problemFrom } from '../../src/api/problem';
import { useRepContext } from '../../src/api/rep';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../../src/theme/tokens';
import { ChoiceChip } from '../../src/ui/controls';
import { Group, Row } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { FootNote, NavBar, Page } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';

/** Up to this many pipelines are chips; more open an action sheet. */
const PIPELINE_CHIPS = 4;

/** The stepper's numbered circle. */
const DOT = 28;

/** The stepper's line above a circle; the name's padding starts from it, so the two line up. */
const STEP_TOP = 12;

/**
 * «Захиалга илгээх тохиргоо» (the OrderSettings board, ADR-0061 #6, ADR-0068; redrawn after the
 * owner's look at 0.3.0, 2026-10-18): a card on top tells where the next order lands and what
 * happens to it (a CONFIRM stage confirms and reserves at once, a NONE stage leaves a draft), then
 * three steps: the board (cards with their branch), its pipeline (chips, or a sheet past
 * PIPELINE_CHIPS) and the stage (a vertical stepper in the pipeline's order). Choosing another
 * board or pipeline takes its first stage, so the next order always has a place; nothing changes
 * while a send waits for its answer.
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
  const choosePipeline = (pipelineId: number) => {
    if (locked || pipelineId === pipeline?.id) return;
    const next = firstStage(pipelineId);
    if (next !== null) setStageId(next);
  };
  const ruleOf = (action: string) =>
    t(action === 'CONFIRM' ? 'mobile.settings.confirms' : 'mobile.settings.drafts');

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
            <PlaceCard
              stageName={stage?.name ?? null}
              path={board && pipeline ? `${board.name} · ${pipeline.name}` : null}
              confirms={stage?.action === 'CONFIRM'}
            />
            {locked ? (
              <View style={styles.locked}>
                <Lock size={13} strokeWidth={2.2} color={colors.muted} />
                <Text style={[type.secondary, styles.grow]}>{t('mobile.settings.locked')}</Text>
              </View>
            ) : null}

            <StepHeader n={1} title={t('mobile.settings.board')} />
            <View accessibilityRole="radiogroup" style={styles.boards}>
              {boards.map((entry) => (
                <BoardCard
                  key={entry.id}
                  name={entry.name}
                  branch={entry.branchName}
                  selected={entry.id === board?.id}
                  disabled={locked}
                  onPress={() => {
                    // The chosen board keeps its stage; another one starts on its first.
                    if (entry.id === board?.id) return;
                    const first = entry.pipelines[0];
                    const next = first ? firstStage(first.id) : null;
                    if (next !== null) setStageId(next);
                  }}
                />
              ))}
            </View>
          </>
        ) : null}

        {board ? (
          <>
            <StepHeader n={2} title={t('mobile.settings.pipeline')} />
            {board.pipelines.length <= PIPELINE_CHIPS ? (
              <View accessibilityRole="radiogroup" style={[styles.chips, locked && styles.dimmed]}>
                {board.pipelines.map((entry) => (
                  <ChoiceChip
                    key={entry.id}
                    label={entry.name}
                    selected={entry.id === pipeline?.id}
                    icon={
                      entry.id === pipeline?.id ? (
                        <Check size={15} strokeWidth={2.8} color={colors.primaryForeground} />
                      ) : undefined
                    }
                    onPress={() => choosePipeline(entry.id)}
                  />
                ))}
              </View>
            ) : (
              <Group>
                <Row
                  title={pipeline?.name ?? t('common.none')}
                  chevron={false}
                  right={<ChevronDown size={16} strokeWidth={2.6} color={colors.input} />}
                  disabled={locked}
                  minHeight={50}
                  onPress={() => setChoosingPipeline(true)}
                />
              </Group>
            )}
          </>
        ) : null}

        {pipeline ? (
          <>
            <StepHeader n={3} title={t('mobile.settings.stage')} />
            <View accessibilityRole="radiogroup" style={styles.stepper}>
              {pipeline.stages.map((entry, index) => (
                <StageStep
                  key={entry.id}
                  n={index + 1}
                  name={entry.name}
                  rule={ruleOf(entry.action)}
                  confirms={entry.action === 'CONFIRM'}
                  first={index === 0}
                  last={index === pipeline.stages.length - 1}
                  selected={entry.id === stageId}
                  disabled={locked}
                  onPress={() => setStageId(entry.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        <FootNote>{t('mobile.settings.footer')}</FootNote>
      </ScrollView>

      <ActionSheet
        visible={choosingPipeline}
        title={t('mobile.settings.pipeline')}
        actions={(board?.pipelines ?? []).map((entry) => ({
          label: entry.name,
          onPress: () => {
            setChoosingPipeline(false);
            choosePipeline(entry.id);
          },
        }))}
        cancelLabel={t('common.cancel')}
        onCancel={() => setChoosingPipeline(false)}
      />
    </Page>
  );
}

/**
 * Where the next order lands: the stage large, its board and pipeline under it, and what happens
 * on sending in the stage's tone (green: confirmed and reserved; orange: a draft; red: no stage).
 */
function PlaceCard({
  stageName,
  path,
  confirms,
}: {
  stageName: string | null;
  path: string | null;
  confirms: boolean;
}) {
  const { t } = useTranslation();
  const tone =
    stageName === null
      ? {
          tint: colors.tint.red,
          soft: colors.destructiveSoft,
          text: colors.destructive,
          icon: (color: string) => <TriangleAlert size={22} strokeWidth={2} color={color} />,
          small: (color: string) => <TriangleAlert size={15} strokeWidth={2.2} color={color} />,
          rule: t('mobile.settings.chooseBelow'),
        }
      : confirms
        ? {
            tint: colors.tint.green,
            soft: colors.successSoft,
            text: colors.success,
            icon: (color: string) => <PackageCheck size={22} strokeWidth={2} color={color} />,
            small: (color: string) => <CircleCheck size={15} strokeWidth={2.2} color={color} />,
            rule: t('mobile.settings.confirms'),
          }
        : {
            tint: colors.tint.orange,
            soft: colors.warningSoft,
            text: colors.warningText,
            icon: (color: string) => <FilePenLine size={22} strokeWidth={2} color={color} />,
            small: (color: string) => <FilePenLine size={15} strokeWidth={2.2} color={color} />,
            rule: t('mobile.settings.drafts'),
          };
  return (
    <View style={styles.place}>
      <View style={styles.placeTop}>
        <View style={[styles.placeIcon, { backgroundColor: tone.tint }]}>
          {tone.icon(colors.primaryForeground)}
        </View>
        <View style={styles.placeText}>
          <Text style={type.sectionHeader}>{t('mobile.settings.next')}</Text>
          <Text style={type.title3} numberOfLines={2}>
            {stageName ?? t('mobile.settings.notChosen')}
          </Text>
          {path ? (
            <Text style={type.secondary} numberOfLines={2}>
              {path}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.outcome, { backgroundColor: tone.soft }]}>
        {tone.small(tone.text)}
        <Text style={[type.bodyStrong, styles.grow, { color: tone.text }]}>{tone.rule}</Text>
      </View>
    </View>
  );
}

/** «① САМБАР»: a step's number in a soft badge and its name. */
function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{String(n)}</Text>
      </View>
      <Text accessibilityRole="header" style={[type.sectionHeader, styles.grow]}>
        {title}
      </Text>
    </View>
  );
}

/** A board to choose: its icon, name and branch, and a round check when chosen. */
function BoardCard({
  name,
  branch,
  selected,
  disabled,
  onPress,
}: {
  name: string;
  branch: string | null;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={branch ? `${name}, ${branch}` : name}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.board,
        pressed && styles.boardPressed,
        selected && styles.boardSelected,
        disabled && !selected && styles.dimmed,
      ]}
    >
      <View style={[styles.boardIcon, selected && styles.boardIconSelected]}>
        <SquareKanban
          size={18}
          strokeWidth={2}
          color={selected ? colors.primaryForeground : colors.label2}
        />
      </View>
      <View style={styles.boardText}>
        <Text style={type.heading} numberOfLines={1}>
          {name}
        </Text>
        {branch ? (
          <View style={styles.branch}>
            <MapPin size={12} strokeWidth={2.2} color={colors.muted} />
            <Text style={[type.secondary, styles.shrink]} numberOfLines={1}>
              {branch}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Check size={13} strokeWidth={3} color={colors.primaryForeground} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * A stage of the stepper: its number in a circle on the line that joins the pipeline's stages (the
 * chosen one filled with the accent), its name and, under it, what sending there does.
 */
function StageStep({
  n,
  name,
  rule,
  confirms,
  first,
  last,
  selected,
  disabled,
  onPress,
}: {
  n: number;
  name: string;
  rule: string;
  confirms: boolean;
  first: boolean;
  last: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${name}, ${rule}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        pressed && styles.stepPressed,
        disabled && !selected && styles.dimmed,
      ]}
    >
      <View style={styles.rail}>
        <View style={[styles.lineTop, first && styles.lineNone]} />
        <View style={[styles.dot, selected && styles.dotSelected]}>
          <Text style={[styles.dotText, selected && styles.onPrimary]}>{String(n)}</Text>
        </View>
        <View style={[styles.lineBottom, last && styles.lineNone]} />
      </View>
      <View style={styles.stepText}>
        <Text style={selected ? type.rowStrong : type.row} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.rule}>
          <View
            style={[
              styles.ruleDot,
              { backgroundColor: confirms ? colors.tint.green : colors.tint.orange },
            ]}
          />
          <Text style={[type.secondary, styles.shrink]}>{rule}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  hint: { marginTop: 6, marginHorizontal: spacing.xs, color: colors.muted },
  loading: { marginTop: spacing.xl },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  dimmed: { opacity: 0.5 },
  onPrimary: { color: colors.primaryForeground },
  place: {
    marginTop: 20,
    padding: spacing.lg,
    gap: 14,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
    boxShadow: shadows.floating,
  },
  placeTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  placeIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeText: { flex: 1, gap: 2 },
  outcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
  },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    marginHorizontal: spacing.xs,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 26,
    marginBottom: 10,
    marginHorizontal: spacing.xs,
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { ...type.badge, ...tabular, color: colors.link },
  boards: { gap: 10 },
  board: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.card,
  },
  boardPressed: { borderColor: colors.accent, backgroundColor: colors.accent },
  boardSelected: { borderColor: colors.primary },
  boardIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.field,
    backgroundColor: colors.fieldFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardIconSelected: { backgroundColor: colors.primary },
  boardText: { flex: 1, gap: 3 },
  branch: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderWidth: 0, backgroundColor: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepper: {
    paddingVertical: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  step: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
    paddingHorizontal: spacing.lg,
  },
  stepPressed: { backgroundColor: colors.accent },
  rail: { width: DOT, alignItems: 'center' },
  lineTop: { width: 2, height: STEP_TOP, backgroundColor: colors.border },
  lineBottom: { width: 2, flex: 1, minHeight: spacing.sm, backgroundColor: colors.border },
  lineNone: { opacity: 0 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    borderColor: colors.input,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    boxShadow: shadows.brand,
  },
  dotText: { ...type.chip, ...tabular, fontFamily: fonts.semibold, color: colors.muted },
  // The name's first line centred on the circle: (DOT − its line height) / 2 below the line.
  stepText: {
    flex: 1,
    gap: 3,
    paddingTop: STEP_TOP + (DOT - type.row.lineHeight) / 2,
    paddingBottom: 14,
  },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleDot: { width: 6, height: 6, borderRadius: 3 },
});
