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

const DEFAULTS: WorkPrefs = { pipelineId: null, view: 'BOARD', panelOpen: true };

function read(key: string): WorkPrefs {
  try {
    const text = window.localStorage.getItem(key);
    if (text === null) return DEFAULTS;
    const value = JSON.parse(text) as Partial<Record<keyof WorkPrefs, unknown>>;
    return {
      pipelineId: typeof value.pipelineId === 'number' ? value.pipelineId : null,
      view: WORK_VIEWS.find((view) => view === value.view) ?? 'BOARD',
      panelOpen: value.panelOpen !== false,
    };
  } catch {
    // Storage blocked or not JSON: the defaults.
    return DEFAULTS;
  }
}

function write(key: string, prefs: WorkPrefs): void {
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
  const [chosen, setChosen] = useState<{ key: string; prefs: WorkPrefs } | null>(null);
  const prefs = chosen?.key === key ? chosen.prefs : stored;
  const update = useCallback(
    (patch: Partial<WorkPrefs>) => {
      setChosen((current) => {
        const base = current?.key === key ? current.prefs : read(key);
        const next = { ...base, ...patch };
        write(key, next);
        return { key, prefs: next };
      });
    },
    [key],
  );
  return { prefs, update };
}
