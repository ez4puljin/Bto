import { addDays } from '@tugeel/shared/time';
import { Check, Megaphone, PackagePlus, Tag, TrendingDown } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { MyNotice } from '../api/notifications';
import { monthDay } from '../dates/calendar';
import { colors } from '../theme/tokens';

type Kind = MyNotice['kind'];

/** «Урамшуулал · 10/16 – 10/31» over a notice's title: its kind and the days it runs. */
export function useNoticeEyebrow() {
  const { t } = useTranslation();
  return (notice: Pick<MyNotice, 'kind' | 'validFrom' | 'validTo'>): string => {
    const period = notice.validTo
      ? t('mobile.notifications.period', {
          from: monthDay(notice.validFrom),
          to: monthDay(addDays(notice.validTo, -1)),
        })
      : t('mobile.notifications.periodOpen', { from: monthDay(notice.validFrom) });
    return `${t(`notifications.kinds.${notice.kind}`)} · ${period}`;
  };
}

/**
 * Each notice kind's colours and icon (ADR-0062 #1) as the Notifications and Launch boards draw
 * them: the list's round badge in `tint`, the popup's picture on `soft` with the eyebrow `strong`.
 */
export const KIND_STYLES: Record<Kind, { tint: string; soft: string; strong: string }> = {
  PROMOTION: { tint: colors.tint.orange, soft: colors.warningSoft, strong: colors.promoText },
  PRICE_DROP: { tint: colors.tint.pink, soft: colors.secondary, strong: colors.link },
  NEW_PRODUCT: { tint: colors.tint.indigo, soft: colors.successSoft, strong: colors.success },
  NEWS: { tint: colors.tint.blue, soft: colors.secondary, strong: colors.link },
};

export function KindIcon({
  kind,
  size = 20,
  color,
}: {
  kind: Kind;
  size?: number;
  color?: string;
}): ReactNode {
  const stroke = color ?? KIND_STYLES[kind].strong;
  switch (kind) {
    case 'PROMOTION':
      return <Tag size={size} color={stroke} strokeWidth={2} />;
    case 'PRICE_DROP':
      return <TrendingDown size={size} color={stroke} strokeWidth={2} />;
    case 'NEW_PRODUCT':
      return <PackagePlus size={size} color={stroke} strokeWidth={2} />;
    case 'NEWS':
      return <Megaphone size={size} color={stroke} strokeWidth={2} />;
  }
}

/** The 40 px round badge before a list item: a notice's kind, or a sold order's check. */
export function FeedBadge({ kind }: { kind: Kind | 'ORDER_SOLD' }) {
  const tint = kind === 'ORDER_SOLD' ? colors.tint.green : KIND_STYLES[kind].tint;
  return (
    <View style={[styles.badge, { backgroundColor: tint }]}>
      {kind === 'ORDER_SOLD' ? (
        <Check size={20} strokeWidth={2.6} color={colors.primaryForeground} />
      ) : (
        <KindIcon kind={kind} color={colors.primaryForeground} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
