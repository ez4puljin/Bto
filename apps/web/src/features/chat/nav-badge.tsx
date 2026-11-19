import { useTranslation } from 'react-i18next';
import { formatCount } from '@/lib/money';
import { useChatUnread } from './api';
import { useChatUnreadLive } from './live';

/**
 * The menu entry's badge: how many conversations wait for a staff answer. The count is read from
 * `GET chat/unread`, refreshed by the live stream while the app is open and by a slow poll.
 */
export function ChatNavBadge() {
  const { t } = useTranslation();
  const unread = useChatUnread();
  useChatUnreadLive(true);
  const waiting = unread.data?.waiting ?? 0;
  if (waiting <= 0) return null;
  return (
    <span
      role="status"
      aria-label={t('chat.web.badge', { count: waiting })}
      className="ml-auto grid h-4.5 min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-[0.6875rem] leading-none font-semibold text-primary-foreground"
    >
      {waiting > 99 ? '99+' : formatCount(waiting)}
    </span>
  );
}
