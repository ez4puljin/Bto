import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppProblem } from '../api/problem';
import type { RepOrder } from '../api/rep';
import { useSendOrder } from '../cart/use-send';
import { colors, fonts, radii, spacing, type } from '../theme/tokens';
import { PillButton } from './controls';
import { ProblemText } from './kit';
import { ActionSheet } from './sheet';

/**
 * A send whose answer never came (ADR-0061 #8): the cart stays locked until «Дахин илгээх» repeats
 * it with its own key (the server replays the order, never a second one), the rep finds it among
 * their orders, or drops it.
 */
export function PendingSendCard({ onSent }: { onSent?: (order: RepOrder) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { resend, forget, sending } = useSendOrder();
  const [unknown, setUnknown] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [asking, setAsking] = useState(false);

  const again = async () => {
    const result = await resend();
    if (!result) return;
    if (result.kind === 'sent') {
      setProblem(null);
      if (onSent) onSent(result.order);
      else router.push(`/order/${result.order.id}`);
    } else if (result.kind === 'unknown') {
      setUnknown(true);
    } else {
      setProblem(result.problem);
    }
  };

  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>{t('mobile.cart.pendingTitle')}</Text>
      <Text style={styles.body}>
        {unknown ? t('mobile.cart.unknownHint') : t('mobile.cart.pendingHint')}
      </Text>
      <ProblemText problem={problem} />
      <PillButton
        title={t('mobile.cart.resend')}
        loading={sending}
        height={44}
        onPress={() => void again()}
      />
      <View style={styles.links}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/orders')}
          hitSlop={6}
        >
          <Text style={styles.link}>{t('mobile.cart.checkOrders')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setAsking(true)} hitSlop={6}>
          <Text style={[styles.link, styles.danger]}>{t('mobile.cart.forget')}</Text>
        </Pressable>
      </View>
      <ActionSheet
        visible={asking}
        title={t('mobile.cart.forgetTitle')}
        message={t('mobile.cart.forgetHint')}
        actions={[
          {
            label: t('mobile.cart.forget'),
            destructive: true,
            onPress: () => {
              setAsking(false);
              void forget();
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setAsking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    gap: 10,
    borderRadius: radii.card,
    backgroundColor: colors.warningSoft,
  },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.warningText },
  body: { ...type.secondary, color: colors.warningText },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 },
  link: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: colors.primary },
  danger: { color: colors.destructive },
});
