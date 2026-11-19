import { useSyncExternalStore } from 'react';

// Whether the chat's live stream is up, for the quiet «Холболт тасарсан» line. Null until the stream
// has reported anything (it is just opening), so the line never flashes on a fresh start.

let up: boolean | null = null;
const listeners = new Set<() => void>();

export function setChatStreamUp(next: boolean | null): void {
  if (up === next) return;
  up = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while the stream is down (it failed and waits to retry); false when up or not yet known. */
export function useChatStreamDown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => up === false,
    () => false,
  );
}
