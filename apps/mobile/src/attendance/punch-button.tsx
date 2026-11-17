import { Timer } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, shadows, spacing, tabular } from '../theme/tokens';
import { Text } from '../ui/text';

/** The round button's outer size, in px. */
export const PUNCH_SIZE = 156;
const STROKE = 8;

/**
 * The big round punch button of «Ирц»: a ring that fills as the day's worked minutes grow, the
 * stopwatch, the action word and the worked time («7 цаг 47 мин», small units). It only looks
 * disabled when `disabled`; the screen's own logic decides what a press does.
 */
export function PunchButton({
  fill,
  action,
  actionColor,
  hours,
  minutes,
  hoursUnit,
  minutesUnit,
  disabled,
  loading,
  label,
  onPress,
}: {
  /** 0…1: worked over scheduled minutes. */
  fill: number;
  action: string;
  actionColor: string;
  hours: number;
  minutes: number;
  hoursUnit: string;
  minutesUnit: string;
  disabled: boolean;
  loading: boolean;
  label: string;
  onPress: () => void;
}) {
  const radius = (PUNCH_SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const ink = disabled ? colors.placeholder : actionColor;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Svg width={PUNCH_SIZE} height={PUNCH_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={PUNCH_SIZE / 2}
          cy={PUNCH_SIZE / 2}
          r={radius}
          stroke={colors.fill}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={PUNCH_SIZE / 2}
          cy={PUNCH_SIZE / 2}
          r={radius}
          stroke={colors.success}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference * fill} ${circumference}`}
          transform={`rotate(-90 ${PUNCH_SIZE / 2} ${PUNCH_SIZE / 2})`}
          opacity={fill > 0 ? 1 : 0}
        />
      </Svg>
      <View style={styles.inside}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Timer size={22} strokeWidth={2.2} color={ink} />
        )}
        <Text style={[styles.action, { color: ink }]} numberOfLines={1}>
          {action}
        </Text>
        <Text style={[styles.time, tabular, disabled && styles.timeDisabled]} numberOfLines={1}>
          {hours > 0 ? (
            <>
              {String(hours)}
              <Text style={styles.unit}>{` ${hoursUnit} `}</Text>
            </>
          ) : null}
          {String(minutes)}
          <Text style={styles.unit}>{` ${minutesUnit}`}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: PUNCH_SIZE,
    height: PUNCH_SIZE,
    borderRadius: PUNCH_SIZE / 2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.floating,
  },
  disabled: { opacity: 0.8 },
  pressed: { opacity: 0.85 },
  inside: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.lg },
  action: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24 },
  time: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  timeDisabled: { color: colors.muted },
  unit: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
});
