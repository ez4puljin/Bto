import { CHAT_LIST_STATES, type ChatListState } from '@tugeel/shared/chat';
import { Settings2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useChatMutations, useChatUnread } from './api';
import { ConversationList } from './conversation-list';
import { ConversationPane } from './conversation-pane';
import { useChatPageLive } from './live';

const stateOf = (value: string | null): ChatListState | null =>
  CHAT_LIST_STATES.find((state) => state === value) ?? null;

/**
 * «Харилцагчийн чат» (ADR-0224): the stores' conversations on the left, waiting ones first, the
 * open one on the right with its reply box. The URL keeps the tab (`?state=`) and the open
 * conversation (`?c=`); new messages arrive on the live stream. A narrow window shows one pane.
 */
export function ChatPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canSettings = useHasPermission('chat.settings.manage');
  const unread = useChatUnread();
  const { read } = useChatMutations();
  const openId = Number.parseInt(params.get('c') ?? '', 10) || null;

  // The default tab is decided once, when the first count arrives: waiting ones if any wait.
  const decided = useRef<ChatListState | null>(null);
  if (decided.current === null && unread.data) {
    decided.current = unread.data.waiting > 0 ? 'WAITING' : 'STAFF';
  }
  const state = stateOf(params.get('state')) ?? decided.current ?? 'WAITING';

  const edit = (patch: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const markRead = read.mutate;
  useEffect(() => {
    if (openId !== null) markRead(openId);
  }, [openId, markRead]);
  useChatPageLive(openId, markRead);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('chat.web.title')}
        description={t('chat.web.description')}
        actions={
          canSettings ? (
            <Button asChild variant="outline">
              <Link to="/chat/settings">
                <Settings2 />
                {t('chat.web.botTexts')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <ConversationList
          className={openId === null ? undefined : 'hidden lg:flex'}
          state={state}
          onState={(next) => edit({ state: next })}
          openId={openId}
          onOpen={(id) => edit({ c: String(id) })}
        />
        <div className={openId === null ? 'hidden lg:block' : undefined}>
          <ConversationPane id={openId} onBack={() => edit({ c: null })} />
        </div>
      </div>
    </div>
  );
}
