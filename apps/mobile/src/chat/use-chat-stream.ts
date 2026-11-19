import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { AnySession } from '../api/session';
import { setChatStreamUp } from './connection';
import { ChatStream, type ChatStreamEvent } from './stream';

/**
 * Keeps one chat stream open while the app is in the foreground (closed in the background, opened
 * again on return, whose `ready` refetches whatever changed meanwhile), like `useLiveStock`.
 * `path` is the route relative to the server (`/api/v1/customer-app/chat/live`); `onEvent` may change
 * on every render. `enabled` false opens nothing.
 */
export function useChatStream<C>(
  session: AnySession,
  path: string,
  onEvent: (event: ChatStreamEvent<C>) => void,
  enabled = true,
): void {
  const latest = useRef(onEvent);
  latest.current = onEvent;
  useEffect(() => {
    if (!enabled) return undefined;
    const stream = new ChatStream<C>({
      url: `${session.server}${path}`,
      token: (rejected) => session.streamToken(rejected),
      onEvent: (event) => latest.current(event),
      onStatus: setChatStreamUp,
    });
    const follow = (state: AppStateStatus) => {
      if (state === 'background') stream.stop();
      else if (state === 'active') stream.start();
    };
    if (AppState.currentState !== 'background') stream.start();
    const subscription = AppState.addEventListener('change', follow);
    return () => {
      subscription.remove();
      stream.stop();
      setChatStreamUp(null);
    };
  }, [session, path, enabled]);
}
