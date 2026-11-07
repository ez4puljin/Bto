import type { ExpiryStatus, ExpiryUrgency } from '@tugeel/shared/expiry';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ExpiryLiability } from './api';
import { daysText, liabilityNames, liabilityShort, URGENCY_TEXT } from './helpers';

const STATUS_VARIANT = {
  REVIEW: 'default',
  CITY_RETURN: 'warning',
  INTERNAL_SALE: 'warning',
  ARCHIVED: 'secondary',
} as const satisfies Record<ExpiryStatus, 'default' | 'warning' | 'secondary'>;

export function ExpiryStatusBadge({ status }: { status: ExpiryStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`expiry.status.${status}`)}</Badge>;
}

/** «12 хоног үлдсэн», coloured by how close the date is; the text comes from the server's days. */
export function DaysLeft(props: {
  daysLeft: number;
  urgency: ExpiryUrgency;
  className?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn(URGENCY_TEXT[props.urgency], props.className)}>
      {daysText(t, props.daysLeft)}
    </span>
  );
}

const LIABILITY_VARIANT = {
  NONE: 'secondary',
  SPECIFIC: 'warning',
  ALL_STAFF: 'destructive',
} as const;

/** The panel's pill: the type in words, its names listed beneath it. */
export function LiabilityTypeBadge({ liability }: { liability: ExpiryLiability }) {
  const { t } = useTranslation();
  return (
    <Badge variant={LIABILITY_VARIANT[liability.type]}>
      {t(`expiry.liabilityType.${liability.type}`)}
    </Badge>
  );
}

/** The list's pill: who in a few words, nothing to say without a liability. */
export function LiabilityBadge({ liability }: { liability: ExpiryLiability }) {
  const { t } = useTranslation();
  if (liability.type === 'NONE') {
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  }
  const text = liabilityShort(t, liability);
  return (
    <Badge
      variant={LIABILITY_VARIANT[liability.type]}
      className="block max-w-full truncate"
      title={liabilityNames(t, liability).join(', ') || text}
    >
      {text}
    </Badge>
  );
}
