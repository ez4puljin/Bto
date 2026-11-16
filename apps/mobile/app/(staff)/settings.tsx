import { useRouter } from 'expo-router';
import {
  Check,
  ChevronDown,
  CircleCheck,
  FilePenLine,
  Lock,
  type LucideIcon,
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
import { Group, Row } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page, SectionHeader } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { Card, Notice, PAGE, type Tone, TONES } from '../../src/ui/staff-kit';
import { StoreHeader } from '../../src/ui/store-header';

/** Up to this many pipelines are chips; more open an action sheet. */
const PIPELINE_CHIPS = 4;

/** A stage's numbered circle. */
const DOT = 28;

/**
 * «Захиалга илгээх тохиргоо» (the Settings board of 2026-11-16; ADR-0061 #6, ADR-0068): a card on
 * top tells where the next order lands and what happens to it (a CONFIRM stage confirms and
 * reserves at once, a NONE stage leaves a draft), then three steps under their labels: the board
 * (cards with their branch), its pipeline (chips, or a sheet past PIPELINE_CHIPS) and the stage
 * (a grouped list in the pipeline's order, the chosen row tinted). Choosing another board or
 * pipeline takes its first stage, so the next order always has a place; nothing changes while a
 * send waits for its answer.
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
    <Page edges={[]}>
      <StoreHeader title={t('mobile.settings.title')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.body, styles.hint]}>{t('mobile.settings.hint')}</Text>
        {context.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {context.error ? (
          <ProblemText problem={problemFrom(context.error)} style={styles.problem} />
        ) : null}
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
              <Notice icon={Lock} tone="warn">
                {t('mobile.settings.locked')}
              </Notice>
            ) : null}

            <View style={styles.block}>
              <StepLabel n={1} title={t('mobile.settings.board')} />
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
            </View>
          </>
        ) : null}

        {board ? (
          <View style={styles.block}>
            <StepLabel n={2} title={t('mobile.settings.pipeline')} />
            {board.pipelines.length <= PIPELINE_CHIPS ? (
              <View accessibilityRole="radiogroup" style={[styles.chips, locked && styles.dimmed]}>
                {board.pipelines.map((entry) => (
                  <PipelineChip
                    key={entry.id}
                    label={entry.name}
                    selected={entry.id === pipeline?.id}
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
                  onPress={() => setChoosingPipeline(true)}
                />
              </Group>
            )}
          </View>
        ) : null}

        {pipeline ? (
          <View style={styles.block}>
            <StepLabel n={3} title={t('mobile.settings.stage')} />
            <Group>
              {pipeline.stages.map((entry, index) => (
                <StageRow
                  key={entry.id}
                  n={index + 1}
                  name={entry.name}
                  rule={ruleOf(entry.action)}
                  confirms={entry.action === 'CONFIRM'}
                  selected={entry.id === stageId}
                  disabled={locked}
                  onPress={() => setStageId(entry.id)}
                />
              ))}
            </Group>
          </View>
        ) : null}

        <Text style={[type.secondary, styles.hint]}>{t('mobile.settings.footer')}</Text>
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
  const look: { tone: Tone; Icon: LucideIcon; Small: LucideIcon; rule: string } =
    stageName === null
      ? {
          tone: 'bad',
          Icon: TriangleAlert,
          Small: TriangleAlert,
          rule: t('mobile.settings.chooseBelow'),
        }
      : confirms
        ? {
            tone: 'ok',
            Icon: PackageCheck,
            Small: CircleCheck,
            rule: t('mobile.settings.confirms'),
          }
        : {
            tone: 'warn',
            Icon: FilePenLine,
            Small: FilePenLine,
            rule: t('mobile.settings.drafts'),
          };
  const palette = TONES[look.tone];
  const ruleColor = look.tone === 'warn' ? colors.warningText : palette.text;
  return (
    <Card style={styles.place}>
      <View style={styles.placeTop}>
        <View style={[styles.placeIcon, { backgroundColor: palette.background }]}>
          <look.Icon size={24} strokeWidth={2} color={palette.text} />
        </View>
        <View style={styles.placeText}>
          <Text style={type.secondary}>{t('mobile.settings.next')}</Text>
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
      <View style={[styles.outcome, { backgroundColor: palette.background }]}>
        <look.Small size={16} strokeWidth={2.2} color={palette.text} />
        <Text style={[type.bodyStrong, styles.grow, { color: ruleColor }]}>{look.rule}</Text>
      </View>
    </Card>
  );
}

/** «1 · САМБАР»: a step's number and its name, above the step's choices. */
function StepLabel({ n, title }: { n: number; title: string }) {
  return <SectionHeader style={styles.label}>{`${n} · ${title}`}</SectionHeader>;
}

/** A board to choose: its tile, name and branch, and a round check when chosen. */
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
        <SquareKanban size={18} strokeWidth={2} color={selected ? colors.link : colors.label2} />
      </View>
      <View style={styles.boardText}>
        <Text style={type.rowStrong} numberOfLines={1}>
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
        {selected ? <Check size={16} strokeWidth={3} color={colors.primaryForeground} /> : null}
      </View>
    </Pressable>
  );
}

/** A pipeline to choose: a white capsule with an edge, blue with a check when chosen. */
function PipelineChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      {selected ? <Check size={15} strokeWidth={2.8} color={colors.primaryForeground} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A stage of the pipeline: its number in a circle (filled when chosen), its name and, under it,
 * what sending there does, in green for a confirming stage and orange for a draft.
 */
function StageRow({
  n,
  name,
  rule,
  confirms,
  selected,
  disabled,
  onPress,
}: {
  n: number;
  name: string;
  rule: string;
  confirms: boolean;
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
        styles.stage,
        pressed && styles.stagePressed,
        selected && styles.stageSelected,
        disabled && !selected && styles.dimmed,
      ]}
    >
      <View style={[styles.dot, selected && styles.dotSelected]}>
        <Text style={[styles.dotText, selected && styles.onPrimary]}>{String(n)}</Text>
      </View>
      <View style={styles.stageText}>
        <Text style={selected ? type.rowStrong : type.row} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[type.secondary, { color: confirms ? colors.success : colors.warning }]}>
          {rule}
        </Text>
      </View>
      {selected ? <Check size={20} strokeWidth={2.4} color={colors.link} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { ...PAGE, paddingBottom: 40 },
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  hint: { marginHorizontal: spacing.xs, color: colors.muted },
  problem: { marginTop: 0 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  dimmed: { opacity: 0.5 },
  onPrimary: { color: colors.primaryForeground },
  place: { gap: spacing.md },
  placeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
  boards: { gap: spacing.sm },
  // The 2 px edge is always there (in the card's white when idle), so choosing moves nothing.
  board: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  boardPressed: { borderColor: colors.accent, backgroundColor: colors.accent },
  boardSelected: { borderColor: colors.primary },
  boardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardIconSelected: { backgroundColor: colors.secondary },
  boardText: { flex: 1, gap: 2 },
  branch: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderWidth: 0, backgroundColor: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...type.chip, color: colors.label2 },
  chipTextOn: { color: colors.primaryForeground },
  stage: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  stagePressed: { backgroundColor: colors.accent },
  stageSelected: { backgroundColor: colors.secondary },
  stageText: { flex: 1, gap: 1 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotSelected: { borderWidth: 0, backgroundColor: colors.primary },
  dotText: { ...type.chip, ...tabular, fontFamily: fonts.semibold, color: colors.muted },
});
