import { AppError } from '../errors/app-error';

export interface ReportGateLimits {
  /** Reports running at once in this process. */
  maxRunning: number;
  /** Of those, one caller's share; the caller's further reports wait behind other people's. */
  maxPerCaller: number;
  /** Reports waiting for their turn; one more is refused at once. */
  maxWaiting: number;
  /** How long a report waits for its turn before it is refused. */
  waitMs: number;
}

interface Waiter {
  caller: string;
  start: () => void;
}

/**
 * The turnstile of the reports (ADR-0193): at most `maxRunning` run at once in a process, at most
 * `maxPerCaller` of them for one caller, and the rest wait their turn in the order they came. A
 * report that would wait longer than `waitMs`, or that finds the line full, is refused with
 * REPORTS_BUSY: a refusal the screen can explain, instead of a pool with no connection left for
 * anyone. One gate per process and nothing shared between processes: each report replica of
 * ADR-0192 has its own.
 */
export class ReportGate {
  readonly stats = { started: 0, waited: 0, refused: 0 };
  private running = 0;
  private readonly runningByCaller = new Map<string, number>();
  private readonly waiting: Waiter[] = [];

  constructor(private readonly limits: ReportGateLimits) {}

  /** What is running and waiting now, for the log and the tests. */
  snapshot(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  /**
   * Resolves with the function that gives the place back, once the caller may run. `signal` takes
   * a waiting report out of the line when its client has gone away.
   */
  enter(caller: string, signal?: AbortSignal): Promise<() => void> {
    if (this.mayStart(caller)) return Promise.resolve(this.start(caller));
    if (this.waiting.length >= this.limits.maxWaiting) return Promise.reject(this.refuse());
    this.stats.waited += 1;
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        caller,
        start: () => {
          cleanup();
          resolve(this.start(caller));
        },
      };
      const leave = () => {
        const at = this.waiting.indexOf(waiter);
        if (at >= 0) this.waiting.splice(at, 1);
        cleanup();
      };
      const onTimeout = () => {
        leave();
        reject(this.refuse());
      };
      const onAbort = () => {
        leave();
        reject(this.refuse());
      };
      const timer = setTimeout(onTimeout, this.limits.waitMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private mayStart(caller: string): boolean {
    return (
      this.running < this.limits.maxRunning &&
      (this.runningByCaller.get(caller) ?? 0) < this.limits.maxPerCaller
    );
  }

  private start(caller: string): () => void {
    this.running += 1;
    this.runningByCaller.set(caller, (this.runningByCaller.get(caller) ?? 0) + 1);
    this.stats.started += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      const left = (this.runningByCaller.get(caller) ?? 1) - 1;
      if (left > 0) this.runningByCaller.set(caller, left);
      else this.runningByCaller.delete(caller);
      this.startWaiting();
    };
  }

  /** The earliest waiters that may run now; one over its own share lets the next caller pass. */
  private startWaiting(): void {
    for (let at = 0; at < this.waiting.length && this.running < this.limits.maxRunning;) {
      const waiter = this.waiting[at];
      if (waiter && this.mayStart(waiter.caller)) {
        this.waiting.splice(at, 1);
        waiter.start();
      } else {
        at += 1;
      }
    }
  }

  private refuse(): AppError {
    this.stats.refused += 1;
    return new AppError('REPORTS_BUSY', 'too many reports are running or waiting', {
      running: this.running,
      waiting: this.waiting.length,
    });
  }
}
