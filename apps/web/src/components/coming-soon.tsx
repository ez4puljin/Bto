import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ListCard } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';

/** «Тун удахгүй» beside a field or a column the system does not use yet. */
export function ComingSoonBadge() {
  const { t } = useTranslation();
  return <Badge variant="secondary">{t('common.comingSoon')}</Badge>;
}

/** The muted note under a field put on hold. */
export function ComingSoonNote({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <ComingSoonBadge />
      {children ?? t('common.binsSoonHint')}
    </span>
  );
}

/** A whole page put on hold: its title, then the note instead of its content. */
export function ComingSoonPage({ title, hint }: { title: string; hint?: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={title} />
      <ListCard>
        <EmptyState
          icon={Clock}
          title={t('common.comingSoon')}
          action={
            <p className="max-w-md text-[13px] text-muted-foreground">
              {hint ?? t('common.binsSoonHint')}
            </p>
          }
        />
      </ListCard>
    </div>
  );
}
