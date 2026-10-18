import { useCallback, useMemo, useState } from 'react';
import { useAuthState } from '@/app/auth-context';

export const WORK_VIEWS = ['BOARD', 'LIST'] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

/** The warehouse sales page as this user left it in this browser (ADR-0057 #7, ADR-0050 style). */
export interface WorkPrefs {
  pipelineId: number | null;
  view: WorkView;
  panelOpen: boolean;
}

/** What the browser keeps: the panel stays `null` until the user opens or closes it. */
interface Stored extends Omit<WorkPrefs, 'panelOpen'> {
  panelOpen: boolean | null;
}

const DEFAULTS: Stored = { pipelineId: null, view: 'BOARD', panelOpen: null };

/**
 * The folding panel of a user who never chose (ADR-0066): open from 1536px; a laptop gives its
 * width to the board's columns. Open where the width cannot be asked (tests).
 */
function widePanel(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 1536px)').matches
    : true;
}

function read(key: string): Stored {
  try {
    const text = window.localStorage.getItem(key);
    if (text === null) return DEFAULTS;
    const value = JSON.parse(text) as Partial<Record<keyof WorkPrefs, unknown>>;
    return {
      pipelineId: typeof value.pipelineId === 'number' ? value.pipelineId : null,
      view: WORK_VIEWS.find((view) => view === value.view) ?? 'BOARD',
      panelOpen: typeof value.panelOpen === 'boolean' ? value.panelOpen : null,
    };
  } catch {
    // Storage blocked or not JSON: the defaults.
    return DEFAULTS;
  }
}

function write(key: string, prefs: Stored): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Storage blocked or full: the choice lasts until the page is closed.
  }
}

/** The signed-in user's last pipeline, view and panel state (`tugeel.salesWork.v1:<userId>`). */
export function useWorkPrefs() {
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : 0;
  const key = `tugeel.salesWork.v1:${userId}`;
  const stored = useMemo(() => read(key), [key]);
  const [wide] = useState(widePanel);
  const [chosen, setChosen] = useState<{ key: string; prefs: Stored } | null>(null);
  const current = chosen?.key === key ? chosen.prefs : stored;
  const prefs: WorkPrefs = { ...current, panelOpen: current.panelOpen ?? wide };
  const update = useCallback(
    (patch: Partial<WorkPrefs>) => {
      setChosen((previous) => {
        const base = previous?.key === key ? previous.prefs : read(key);
        const next = { ...base, ...patch };
        write(key, next);
        return { key, prefs: next };
      });
    },
    [key],
  );
  return { prefs, update };
}
