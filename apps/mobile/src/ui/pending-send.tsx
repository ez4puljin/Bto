import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import type { AppProblem } from '../api/problem';
import type { RepOrder } from '../api/rep';
import type { Sender } from '../cart/use-idempotent-send';
import { useSendOrder } from '../cart/use-send';
import { brandSheet } from '../theme/brand';
import { colors, fonts, radii, spacing, type } from '../theme/tokens';
import { PillButton } from './controls';
import { ProblemText } from './kit';
import { ActionSheet } from './sheet';

export interface PendingSendWords {
  unknownHint: string;
  checkOrders: string;
  forgetHint: string;
}

/** The rep's pending send (ADR-0061 #8) on the staff app's send. */
export function PendingSendCard({ onSent }: { onSent?: (order: RepOrder) => void }) {
  return <PendingSendView sender={useSendOrder()} {...(onSent ? { onSent } : {})} />;
}

/**
 * A send whose answer never came (ADR-0061 #8, ADR-0079 #5): the cart stays locked until «Дахин
 * илгээх» repeats it with its own key (the server replays the order, never a second one), the
 * orders show it, or it is dropped. Either app passes its own sender.
 */
export function PendingSendView<O extends { id: number }>({
  sender,
  onSent,
  words,
}: {
  sender: Sender<O>;
  onSent?: (order: O) => void;
  /** The app's own words where they name its orders' tab («Миний захиалгууд» / «Захиалга»). */
  words?: PendingSendWords;
}) {
  const { t } = useTranslation();
  const said = words ?? {
    unknownHint: t('mobile.cart.unknownHint'),
    checkOrders: t('mobile.cart.checkOrders'),
    forgetHint: t('mobile.cart.forgetHint'),
  };
  const router = useRouter();
  const { resend, forget, sending } = sender;
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
      <Text style={styles.body}>{unknown ? said.unknownHint : t('mobile.cart.pendingHint')}</Text>
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
          <Text style={styles.link}>{said.checkOrders}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setAsking(true)} hitSlop={6}>
          <Text style={[styles.link, styles.danger]}>{t('mobile.cart.forget')}</Text>
        </Pressable>
      </View>
      <ActionSheet
        visible={asking}
        title={t('mobile.cart.forgetTitle')}
        message={said.forgetHint}
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

const styles = brandSheet(() =>
  StyleSheet.create({
    card: {
      marginTop: spacing.lg,
      padding: spacing.lg,
      gap: 10,
      borderRadius: radii.card,
      backgroundColor: colors.warningSoft,
    },
    title: { ...type.rowStrong, color: colors.warningText },
    body: { ...type.secondary, color: colors.warningText },
    links: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 },
    link: { ...type.row, fontFamily: fonts.medium, color: colors.primary },
    danger: { color: colors.destructive },
  }),
);
