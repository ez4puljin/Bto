import { Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { EmptyState, ListCard } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarkdownView } from '@/features/guide/markdown-view';
import { NEWS_DIALOG } from '@/lib/features';
import { markAllRead, NEWS, type NewsEntry, readIds, unreadOf } from './news';

function EntryView({ entry }: { entry: NewsEntry }) {
  return (
    <article className="flex flex-col gap-2 border-b border-border/80 pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-[0.9375rem] font-semibold">{entry.title}</h3>
        <time dateTime={entry.date} className="text-xs text-muted-foreground tabular-nums">
          {entry.date}
        </time>
      </div>
      <MarkdownView blocks={entry.blocks} />
    </article>
  );
}

/** The shell's news (ADR-0251); off in tests (`lib/features.ts`). */
export function NewsDialog() {
  return NEWS_DIALOG ? <UnreadNews /> : null;
}

/**
 * The news a signed-in user has not read yet (ADR-0251), opened once by the shell when there is
 * any: every unread entry, newest first; closing it marks them all read in this browser.
 */
export function UnreadNews() {
  const { t } = useTranslation();
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : null;
  const [shown, setShown] = useState<readonly NewsEntry[]>([]);

  useEffect(() => {
    setShown(userId === null ? [] : unreadOf(NEWS, readIds(userId)));
  }, [userId]);

  const close = () => {
    if (userId !== null) markAllRead(userId, NEWS);
    setShown([]);
  };

  if (shown.length === 0) return null;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent size="lg" guard={false}>
        <DialogHeader>
          <DialogTitle>{t('news.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('news.dialogDescription', { count: shown.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {shown.map((entry) => (
            <EntryView key={entry.id} entry={entry} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" asChild>
            <Link to="/news" onClick={close}>
              {t('news.all')}
            </Link>
          </Button>
          <DialogClose asChild>
            <Button>{t('news.gotIt')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «Систем → Шинэ өөрчлөлтүүд»: every entry, to read again what was closed (ADR-0251). */
export function NewsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t('news.title')} description={t('news.description')} />
      <ListCard>
        {NEWS.length === 0 ? (
          <EmptyState icon={Megaphone} title={t('news.empty')} />
        ) : (
          <div className="flex flex-col gap-4 p-5">
            {NEWS.map((entry) => (
              <EntryView key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </ListCard>
    </div>
  );
}
