import { CircleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import type { AppProblem } from '../api/problem';
import { colors, radii, spacing, type } from '../theme/tokens';
import { useProblemText } from '../ui/kit';
import { Text } from '../ui/text';
import { isPrintCode } from './problem';

/**
 * The words of a failed call on «Үнийн шошго»: the printing module's own codes by their
 * `errors.<code>` text (e.g. PRINT_NO_TILL «Танд Пос тохируулаагүй байна»), every other code as
 * every staff screen says it (`useProblemText`: no answer, Bto's catalog, else «Алдаа гарлаа»).
 */
export function useLabelProblemText() {
  const { t } = useTranslation();
  const shared = useProblemText();
  return (problem: AppProblem): string =>
    isPrintCode(problem.code) ? t(`errors.${problem.code}`, problem.params ?? {}) : shared(problem);
}

/** A failure's message in a red box with its alert sign, as `ProblemText` draws one. */
export function ProblemBox({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityRole="alert" style={[styles.box, style]}>
      <CircleAlert size={18} strokeWidth={2} color={colors.destructive} style={styles.icon} />
      <Text style={[type.body, styles.text]}>{text}</Text>
    </View>
  );
}

/** The problem of a failed call in that box; nothing without one. */
export function LabelProblem({
  problem,
  style,
}: {
  problem: AppProblem | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const text = useLabelProblemText();
  if (!problem) return null;
  return <ProblemBox text={text(problem)} {...(style ? { style } : {})} />;
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.destructiveSoft,
    borderRadius: radii.field,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  icon: { marginTop: 0.5 },
  text: { flex: 1, color: colors.destructive },
});
