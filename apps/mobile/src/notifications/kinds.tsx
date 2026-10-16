import { addDays } from '@tugeel/shared/time';
import { CircleCheck, Megaphone, PackagePlus, Tag, TrendingDown } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { MyNotice } from '../api/notifications';
import { shortDate } from '../dates/dates';
import { colors } from '../theme/tokens';

type Kind = MyNotice['kind'];

/** «Урамшуулал · 10-16 – 10-23» over a notice's title: its kind and the days it runs. */
export function useNoticeEyebrow() {
  const { t } = useTranslation();
  return (notice: Pick<MyNotice, 'kind' | 'validFrom' | 'validTo'>): string => {
    const period = notice.validTo
      ? t('mobile.notifications.period', {
          from: shortDate(notice.validFrom),
          to: shortDate(addDays(notice.validTo, -1)),
        })
      : t('mobile.notifications.periodOpen', { from: shortDate(notice.validFrom) });
    return `${t(`notifications.kinds.${notice.kind}`)} · ${period}`;
  };
}

/** Each notice kind's tint and icon (ADR-0062 #1), as the design draws them. */
export const KIND_STYLES: Record<Kind, { soft: string; strong: string }> = {
  PROMOTION: { soft: colors.warningSoft, strong: colors.warning },
  PRICE_DROP: { soft: colors.destructiveSoft, strong: colors.destructive },
  NEW_PRODUCT: { soft: colors.successSoft, strong: colors.success },
  NEWS: { soft: colors.infoSoft, strong: colors.primary },
};

export function KindIcon({ kind, size = 20 }: { kind: Kind; size?: number }): ReactNode {
  const color = KIND_STYLES[kind].strong;
  switch (kind) {
    case 'PROMOTION':
      return <Tag size={size} color={color} />;
    case 'PRICE_DROP':
      return <TrendingDown size={size} color={color} />;
    case 'NEW_PRODUCT':
      return <PackagePlus size={size} color={color} />;
    case 'NEWS':
      return <Megaphone size={size} color={color} />;
  }
}

/** The round tinted badge before a list item: a notice's kind, or a sold order. */
export function FeedBadge({ kind }: { kind: Kind | 'ORDER_SOLD' }) {
  const soft = kind === 'ORDER_SOLD' ? colors.successSoft : KIND_STYLES[kind].soft;
  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      {kind === 'ORDER_SOLD' ? (
        <CircleCheck size={20} color={colors.success} />
      ) : (
        <KindIcon kind={kind} />
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
