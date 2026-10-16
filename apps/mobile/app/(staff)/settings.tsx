import { useRouter } from 'expo-router';
import { Check, ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../../src/api/problem';
import { useRepContext } from '../../src/api/rep';
import { useShop } from '../../src/state/shop';
import { colors, spacing, type } from '../../src/theme/tokens';
import { Card, EmptyState, ProblemText, Screen, SectionTitle, Title } from '../../src/ui/kit';

/**
 * «Захиалга бүртгэх тохиргоо» (ADR-0061 #6): the board, pipeline and stage new orders land on,
 * among those the rep may place on; a CONFIRM stage reserves at once, a NONE stage leaves a draft.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const context = useRepContext();
  const { stageId, setStageId, pending } = useShop();

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ChevronLeft size={24} color={colors.primary} />
        <Text style={[type.body, { color: colors.link }]}>{t('common.back')}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.body}>
        <Title>{t('mobile.settings.title')}</Title>
        <Text style={type.secondary}>{t('mobile.settings.hint')}</Text>
        {context.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {context.error ? <ProblemText problem={problemFrom(context.error)} /> : null}
        {context.data && context.data.boards.length === 0 ? (
          <EmptyState title={t('mobile.settings.none')} hint={t('mobile.settings.noneHint')} />
        ) : null}
        {context.data?.boards.map((board) => (
          <View key={board.id} style={styles.board}>
            <SectionTitle>{board.name}</SectionTitle>
            {board.pipelines.map((pipeline) => (
              <Card key={pipeline.id}>
                <Text style={type.heading}>{pipeline.name}</Text>
                {pipeline.stages.map((stage) => {
                  const selected = stage.id === stageId;
                  return (
                    <Pressable
                      key={stage.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: pending !== null }}
                      disabled={pending !== null}
                      onPress={() => setStageId(stage.id)}
                      style={[styles.stage, selected && styles.selected]}
                    >
                      <View style={styles.grow}>
                        <Text style={type.bodyStrong}>{stage.name}</Text>
                        <Text style={type.caption}>
                          {t(
                            stage.action === 'CONFIRM'
                              ? 'mobile.settings.confirms'
                              : 'mobile.settings.drafts',
                          )}
                        </Text>
                      </View>
                      {selected ? <Check size={22} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 44 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  board: { gap: spacing.sm },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  selected: { backgroundColor: colors.secondary },
  grow: { flex: 1, gap: 2 },
});
