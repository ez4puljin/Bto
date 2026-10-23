/**
 * Short confirmations («Хадгалагдлаа») shown at the bottom of the screen for a few seconds
 * (ADR-0042). Errors stay in ProblemAlert next to what failed. A module-level store read with
 * useSyncExternalStore, like the auth session: any code may call `toast.success(...)`. A `warning`
 * is a reminder that did not stop what was done (an overdue debt at a confirmation, ADR-0101).
 */
export type ToastTone = 'success' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION_MS = 4000;
const MAX_TOASTS = 3;

let items: readonly ToastItem[] = [];
let nextId = 1;
let paused = false;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function stopTimer(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function startTimer(id: number) {
  stopTimer(id);
  if (!paused)
    timers.set(
      id,
      setTimeout(() => dismissToast(id), DURATION_MS),
    );
}

function show(message: string, tone: ToastTone): number {
  // The same message again restarts its timer instead of stacking a copy (and a second match).
  const same = items.find((item) => item.message === message);
  if (same) {
    startTimer(same.id);
    return same.id;
  }
  const item: ToastItem = { id: nextId++, message, tone };
  const kept = [...items, item].slice(-MAX_TOASTS);
  for (const dropped of items) if (!kept.includes(dropped)) stopTimer(dropped.id);
  items = kept;
  startTimer(item.id);
  emit();
  return item.id;
}

export const toast = {
  success: (message: string) => show(message, 'success'),
  info: (message: string) => show(message, 'info'),
  warning: (message: string) => show(message, 'warning'),
};

export function dismissToast(id: number) {
  stopTimer(id);
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  emit();
}

/** While the pointer rests on the toasts they stay; they leave a full period after it moves off. */
export function pauseToasts() {
  paused = true;
  for (const id of [...timers.keys()]) stopTimer(id);
}

export function resumeToasts() {
  paused = false;
  for (const item of items) startTimer(item.id);
}

/** Tests start clean. */
export function clearToasts() {
  for (const id of [...timers.keys()]) stopTimer(id);
  paused = false;
  if (items.length === 0) return;
  items = [];
  emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastItem[] {
  return items;
}
