import { Bell, Megaphone, PackageCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCount, formatTugrik } from '@/lib/money';
import { cn } from '@/lib/utils';
import {
  type MyNotice,
  type MyNotification,
  useInboxItems,
  useInboxSummary,
  useMarkInboxRead,
} from './api';

const MAX_SHOWN = 8;

/** One line of the inbox: a running notice or an own notification, newest first. */
type Entry =
  | { kind: 'notice'; at: string; read: boolean; notice: MyNotice }
  | { kind: 'own'; at: string; read: boolean; item: MyNotification };

function entriesOf(notices: readonly MyNotice[], items: readonly MyNotification[]): Entry[] {
  return [
    ...notices.map((notice): Entry => ({
      kind: 'notice',
      at: notice.createdAt,
      read: notice.read,
      notice,
    })),
    ...items.map((item): Entry => ({ kind: 'own', at: item.createdAt, read: item.read, item })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_SHOWN);
}

function useInbox(itemsEnabled: boolean) {
  const summary = useInboxSummary();
  const items = useInboxItems(itemsEnabled);
  const entries = entriesOf(summary.data?.notices ?? [], items.data?.data ?? []);
  return { unread: summary.data?.unread ?? 0, entries, loaded: summary.isSuccess };
}

function EntryText({ entry }: { entry: Entry }) {
  const { t } = useTranslation();
  if (entry.kind === 'notice') {
    return (
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{entry.notice.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {t(`notifications.kinds.${entry.notice.kind}`)}
        </span>
      </span>
    );
  }
  const { item } = entry;
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">
        {t('shell.orderSold', { number: item.orderNumber })}
      </span>
      <span className="block truncate text-[13px] text-muted-foreground">
        {t('shell.orderSoldTo', {
          customer: item.customerName,
          total: item.orderTotal === null ? '' : formatTugrik(item.orderTotal),
        })}
      </span>
    </span>
  );
}

function EntryIcon({ entry }: { entry: Entry }) {
  const Icon = entry.kind === 'notice' ? Megaphone : PackageCheck;
  return (
    <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-link">
      <Icon aria-hidden className="size-4" />
      {entry.read ? null : (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
      )}
    </span>
  );
}

const orderLink = (entry: Entry) =>
  entry.kind === 'own' && entry.item.orderId !== null
    ? `/sales/orders/${entry.item.orderId}`
    : null;

/**
 * The top bar's 🔔 (ADR-0114): the unread count of the user's inbox (the notices an admin sends and
 * the user's own notifications, ADR-0062 #3), and on opening the newest lines, which are then
 * marked read. A sold order opens its order.
 */
export function InboxBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inbox = useInbox(true);
  const markRead = useMarkInboxRead();

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const noticeIds = inbox.entries.flatMap((entry) =>
      entry.kind === 'notice' && !entry.read ? [entry.notice.id] : [],
    );
    const notificationIds = inbox.entries.flatMap((entry) =>
      entry.kind === 'own' && !entry.read ? [entry.item.id] : [],
    );
    if (noticeIds.length + notificationIds.length > 0) {
      markRead.mutate({ noticeIds, notificationIds });
    }
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            inbox.unread > 0
              ? t('shell.notificationsUnread', { count: inbox.unread })
              : t('shell.notifications')
          }
          title={t('shell.notifications')}
        >
          <Bell />
          {inbox.unread > 0 ? (
            <span
              aria-hidden
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-primary-foreground"
            >
              {inbox.unread > 99 ? '99+' : formatCount(inbox.unread)}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[min(22rem,calc(100vw-2rem))]">
        <DropdownMenuLabel>{t('shell.notifications')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {inbox.entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t('shell.noNotifications')}
          </p>
        ) : (
          inbox.entries.map((entry) => {
            const to = orderLink(entry);
            return (
              <DropdownMenuItem
                key={`${entry.kind}-${entry.kind === 'notice' ? entry.notice.id : entry.item.id}`}
                className="items-start gap-2.5 py-2"
                onSelect={to ? () => void navigate(to) : undefined}
              >
                <EntryIcon entry={entry} />
                <EntryText entry={entry} />
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The home page's «Мэдэгдэл» card body (ADR-0114): the same newest lines, read-only. */
export function InboxList() {
  const { t } = useTranslation();
  const inbox = useInbox(true);
  if (inbox.entries.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('shell.noNotifications')}
      </p>
    );
  }
  return (
    <ul>
      {inbox.entries.slice(0, 5).map((entry) => {
        const to = orderLink(entry);
        const body = (
          <>
            <EntryIcon entry={entry} />
            <EntryText entry={entry} />
          </>
        );
        const row = 'flex items-center gap-3 px-4 py-2.5 text-sm';
        return (
          <li
            key={`${entry.kind}-${entry.kind === 'notice' ? entry.notice.id : entry.item.id}`}
            className="border-b border-border/80 last:border-0"
          >
            {to ? (
              <Link to={to} className={cn(row, 'transition-colors hover:bg-accent/70')}>
                {body}
              </Link>
            ) : (
              <div className={row}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
