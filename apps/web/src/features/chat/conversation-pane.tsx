import { CHAT_LIMITS, chatLength } from '@tugeel/shared/chat';
import { ArrowLeft, ExternalLink, MessageSquareDashed, Send, X } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, ListCard } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import {
  type ChatMessage,
  messagesOf,
  useChatConversation,
  useChatMessages,
  useChatMutations,
} from './api';
import { chatTime } from './format';

function Bubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const mine = message.sender !== 'CUSTOMER';
  return (
    <li className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap',
          message.sender === 'CUSTOMER' && 'rounded-bl-md bg-fill text-foreground',
          message.sender === 'STAFF' && 'rounded-br-md bg-primary text-primary-foreground',
          message.sender === 'BOT' && 'rounded-br-md bg-secondary text-foreground',
        )}
      >
        {message.body}
      </div>
      {message.buttons && message.buttons.length > 0 ? (
        <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.buttons.map((button) => (
            <li
              key={button.id}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {button.label}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        {message.sender === 'BOT' ? <Badge variant="secondary">{t('chat.web.bot')}</Badge> : null}
        {message.sender === 'STAFF' && message.staffName ? <span>{message.staffName}</span> : null}
        <span>{chatTime(message.createdAt)}</span>
      </span>
    </li>
  );
}

/** The reply box: Enter sends, Shift+Enter a new line; a failed send keeps the text. */
function Composer({ id, onSent }: { id: number; onSent: () => void }) {
  const { t } = useTranslation();
  const { reply } = useChatMutations();
  const action = useAction();
  const [text, setText] = useState('');
  // One key per typed message: a retry of the same text replays the same send (ADR-0004).
  const key = useRef<string | null>(null);
  const length = chatLength(text.trim());
  const over = length > CHAT_LIMITS.messageMax;
  const canSend = length > 0 && !over && !reply.isPending;

  const send = () => {
    if (!canSend) return;
    const sending = text.trim();
    key.current ??= randomUuid();
    const sendKey = key.current;
    void action
      .run(() => reply.mutateAsync({ id, text: sending, key: sendKey }))
      .then((ok) => {
        if (!ok) return;
        key.current = null;
        setText('');
        onSent();
      });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border/80 p-3">
      <ProblemAlert problem={action.problem} />
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={t('chat.web.replyLabel')}
          placeholder={t('chat.web.replyPlaceholder')}
          value={text}
          rows={2}
          className="max-h-40 min-h-12 flex-1 resize-none"
          aria-invalid={over}
          onChange={(event) => {
            setText(event.target.value);
            key.current = null;
          }}
          onKeyDown={onKeyDown}
        />
        <Button pending={reply.isPending} disabled={!canSend} onClick={send}>
          <Send />
          {t('chat.web.send')}
        </Button>
      </div>
      {length > CHAT_LIMITS.messageMax * 0.8 ? (
        <p
          className={cn('text-right text-xs', over ? 'text-destructive' : 'text-muted-foreground')}
        >
          {t('chat.web.count', { count: length, max: CHAT_LIMITS.messageMax })}
        </p>
      ) : null}
    </div>
  );
}

/** The right pane: the store's header, its messages (older ones on scrolling up) and the reply box. */
export function ConversationPane(props: { id: number | null; onBack: () => void }) {
  const { t } = useTranslation();
  const { id } = props;
  const conversation = useChatConversation(id);
  const messages = useChatMessages(id);
  const { close } = useChatMutations();
  const closing = useAction();
  const canOpenCustomer = useHasPermission('partners.customers.read');
  const [confirm, setConfirm] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef({
    id: null as number | null,
    first: null as number | null,
    tail: null as number | null,
    height: 0,
  });
  const stick = useRef(true);
  const list = messagesOf(messages.data);
  const first = list[0]?.id ?? null;
  const tail = list.at(-1)?.id ?? null;

  // Opened: the end. Older messages prepended: stay where the reader was. A new message: follow it
  // while the reader is at the end.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const before = last.current;
    if (before.id !== id || before.first === null) {
      element.scrollTop = element.scrollHeight;
      stick.current = true;
    } else if (first !== before.first && tail === before.tail) {
      element.scrollTop += element.scrollHeight - before.height;
    } else if (tail !== before.tail && stick.current) {
      element.scrollTop = element.scrollHeight;
    }
    last.current = { id, first, tail, height: element.scrollHeight };
  }, [id, first, tail]);

  if (id === null) {
    return (
      <ListCard className="hidden min-h-[24rem] lg:block">
        <EmptyState title={t('chat.web.pick')} icon={MessageSquareDashed} />
      </ListCard>
    );
  }

  const onScroll = () => {
    const element = box.current;
    if (!element) return;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (element.scrollTop < 80 && messages.hasNextPage && !messages.isFetchingNextPage) {
      void messages.fetchNextPage();
    }
  };
  const data = conversation.data;
  const problem = problemFromError(conversation.error) ?? problemFromError(messages.error);
  const names = data?.reps.map((rep) => rep.name).join(', ') ?? '';
  return (
    <ListCard scroll beside className="flex min-h-[24rem] flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/80 px-3.5 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label={t('chat.web.back')}
          onClick={props.onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {data?.customerName}
            <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
              {data?.customerCode}
            </span>
          </h2>
          {data ? (
            <p className="truncate text-xs text-muted-foreground">
              {names ? t('chat.web.reps', { names }) : t('chat.web.noReps')}
            </p>
          ) : null}
        </div>
        {data && canOpenCustomer ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/partners/customers/${data.customerId}`}>
              <ExternalLink />
              {t('chat.web.customerPage')}
            </Link>
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!data || data.mode === 'BOT'}
          onClick={() => setConfirm(true)}
        >
          <X />
          {t('chat.web.close')}
        </Button>
      </div>
      <ProblemAlert problem={problem} />
      <div
        ref={box}
        onScroll={onScroll}
        role="log"
        aria-label={t('chat.web.messagesLabel')}
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3"
      >
        {messages.hasNextPage ? (
          <div className="mb-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-link"
              pending={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              {t('chat.web.loadOlder')}
            </Button>
          </div>
        ) : null}
        {list.length === 0 && !messages.isPending ? (
          <EmptyState title={t('chat.web.noMessages')} icon={MessageSquareDashed} />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
          </ul>
        )}
      </div>
      {data?.mode === 'BOT' ? (
        <p className="shrink-0 px-3.5 pb-1 text-xs text-muted-foreground">
          {t('chat.web.botHint')}
        </p>
      ) : null}
      <div className="shrink-0">
        <Composer
          key={id}
          id={id}
          onSent={() => {
            stick.current = true;
          }}
        />
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('chat.web.closeTitle')}
        description={t('chat.web.closeDescription')}
        confirmLabel={t('chat.web.closeConfirm')}
        variant="default"
        pending={close.isPending}
        problem={closing.problem}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          void closing
            .run(() => close.mutateAsync(id))
            .then((ok) => {
              if (ok) setConfirm(false);
            })
        }
      />
    </ListCard>
  );
}
