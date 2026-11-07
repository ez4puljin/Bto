import { useNavigation } from 'expo-router';
import { type NavigationAction, usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';

export interface LeaveGuard {
  /** The question stands: `LeaveSheet` shows it. */
  asking: boolean;
  stay: () => void;
  /** Drops what was typed and carries out the leaving the person asked for. */
  leave: () => void;
  /** Before the screen's own `router.back()` after a save: nothing is left to lose, so no question. */
  release: () => void;
}

/**
 * While something typed is unsaved, whatever would remove the screen (the header's arrow, Android's
 * back) waits for the person's word (ADR-0172 #9). Dropping carries out the very action that was
 * held, never a new back: that action remembers this screen has been asked, so it passes at the
 * first press where a new one would only ask again. `usePreventRemove` is expo-router's own copy of
 * React Navigation's, as the app has no `@react-navigation/*` of its own. A sign-out passes without
 * a word, since `Stack.Protected` drops the screen without asking it.
 */
export function useLeaveGuard(unsaved: boolean): LeaveGuard {
  const navigation = useNavigation();
  const [held, setHeld] = useState<NavigationAction | null>(null);
  const released = useRef(false);

  usePreventRemove(unsaved, ({ data }) => {
    if (released.current) navigation.dispatch(data.action);
    else setHeld(data.action);
  });

  // A save answered while the sheet was up has left nothing to ask about. Done while rendering, or
  // a question still held would come up again at the next thing typed.
  if (held !== null && !unsaved) setHeld(null);

  return {
    asking: held !== null,
    stay: () => setHeld(null),
    leave: () => {
      setHeld(null);
      if (held !== null) navigation.dispatch(held);
    },
    release: () => {
      released.current = true;
      setHeld(null);
    },
  };
}
