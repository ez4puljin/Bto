import { CHAT_LIST_STATES, type ChatListState } from '@tugeel/shared/chat';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ListCard, LoadMore, SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { type ChatConversation, useChatConversations } from './api';
import { chatTime } from './format';

const firstLine = (body: string) => body.split('\n').find((line) => line.trim() !== '') ?? '';

function Row({
  conversation,
  active,
  onOpen,
}: {
  conversation: ChatConversation;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const last = conversation.lastMessage;
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onOpen}
        className={cn(
          'flex w-full flex-col gap-1 border-b border-border/80 px-3.5 py-2.5 text-left transition-colors outline-none hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset touch:min-h-11',
          active && 'bg-secondary',
        )}
      >
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              conversation.unread > 0 ? 'font-semibold' : 'font-medium',
            )}
          >
            {conversation.customerName}
            <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
              {conversation.customerCode}
            </span>
          </span>
          {last ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {chatTime(last.createdAt)}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted-foreground">
            {last ? firstLine(last.body) : t('chat.web.noMessage')}
          </span>
          {conversation.awaitingStaff ? (
            <Badge variant="warning">{t('chat.web.awaiting')}</Badge>
          ) : null}
          {conversation.mode === 'BOT' ? (
            <Badge variant="secondary">{t('chat.web.bot')}</Badge>
          ) : null}
          {conversation.unread > 0 ? (
            <span
              aria-label={t('chat.web.unread', { count: conversation.unread })}
              className="grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] leading-none font-semibold text-primary-foreground"
            >
              {conversation.unread > 99 ? '99+' : conversation.unread}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** The left pane: the tabs and the conversations of the chosen one, latest first. */
export function ConversationList(props: {
  state: ChatListState;
  onState: (state: ChatListState) => void;
  openId: number | null;
  onOpen: (id: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const list = useChatConversations(props.state);
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', props.className)}>
      <SegmentedControl
        options={CHAT_LIST_STATES}
        value={props.state}
        name={t('chat.web.stateLabel')}
        label={(state) => t(`chat.web.states.${state}`)}
        onChange={props.onState}
      />
      <ProblemAlert problem={problemFromError(list.error)} onRetry={list.refetch} />
      <ListCard scroll beside>
        {rows.length === 0 && !list.isPending ? (
          <EmptyState title={t(`chat.web.empty.${props.state}`)} icon={MessagesSquare} />
        ) : (
          <ul aria-label={t('chat.web.listLabel')}>
            {rows.map((conversation) => (
              <Row
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === props.openId}
                onOpen={() => props.onOpen(conversation.id)}
              />
            ))}
          </ul>
        )}
        <LoadMore query={list} />
      </ListCard>
    </div>
  );
}
