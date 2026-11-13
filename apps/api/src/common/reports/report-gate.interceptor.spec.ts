import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, type Observable, Subject, throwError } from 'rxjs';
import { ReportGate } from './report-gate';
import { ReportGateInterceptor, UngatedReport } from './report-gate.interceptor';

class Routes {
  heavy(): void {}

  @UngatedReport()
  light(): void {}
}

class FakeResponse extends EventEmitter {
  writableEnded = false;
  readonly headers: Record<string, string> = {};

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
}

function setup(maxRunning = 1) {
  const gate = new ReportGate({ maxRunning, maxPerCaller: 1, maxWaiting: 1, waitMs: 5_000 });
  const interceptor = new ReportGateInterceptor(gate, new Reflector());
  const call = (route: keyof Routes, userId: number | undefined, handler: CallHandler) => {
    const response = new FakeResponse();
    const context = {
      getHandler: () => Routes.prototype[route],
      switchToHttp: () => ({
        getRequest: () => (userId === undefined ? {} : { auth: { userId } }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { response, result: interceptor.intercept(context, handler) };
  };
  return { gate, call };
}

const answering = (source: Observable<unknown>): CallHandler => ({ handle: () => source });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ReportGateInterceptor', () => {
  it('holds a place while the handler works and gives it back with the answer', async () => {
    const { gate, call } = setup();
    const work = new Subject<string>();
    const answer = firstValueFrom(call('heavy', 1, answering(work)).result);
    await settle();
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 0 });
    work.next('report');
    work.complete();
    await expect(answer).resolves.toBe('report');
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('gives the place back when the handler fails', async () => {
    const { gate, call } = setup();
    const failure = new Error('the report failed');
    const { result } = call('heavy', 1, answering(throwError(() => failure)));
    await expect(firstValueFrom(result)).rejects.toBe(failure);
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('lets a light route through while every place is taken', async () => {
    const { gate, call } = setup();
    const work = new Subject<string>();
    const heavy = firstValueFrom(call('heavy', 1, answering(work)).result);
    await settle();
    const light = new Subject<string>();
    const options = firstValueFrom(call('light', 2, answering(light)).result);
    light.next('options');
    await expect(options).resolves.toBe('options');
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 0 });
    work.next('done');
    work.complete();
    await heavy;
  });

  it('refuses with Retry-After when the line is full, by caller', async () => {
    const { gate, call } = setup(2);
    const work = new Subject<string>();
    const first = firstValueFrom(call('heavy', 1, answering(work)).result);
    // The same caller again: over its share of one, so it waits though a place is free.
    const second = firstValueFrom(call('heavy', 1, answering(work)).result);
    await settle();
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 1 });
    const third = call('heavy', 1, answering(work));
    await expect(firstValueFrom(third.result)).rejects.toMatchObject({ code: 'REPORTS_BUSY' });
    expect(third.response.headers['Retry-After']).toBe('15');
    work.next('done');
    work.complete();
    await expect(first).resolves.toBe('done');
    await second.catch(() => undefined);
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('drops a waiting report whose client has gone, without a Retry-After', async () => {
    const { gate, call } = setup();
    const work = new Subject<string>();
    const running = firstValueFrom(call('heavy', 1, answering(work)).result);
    await settle();
    const waiting = call('heavy', 2, answering(work));
    const outcome = firstValueFrom(waiting.result);
    await settle();
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 1 });
    waiting.response.emit('close');
    await expect(outcome).rejects.toMatchObject({ code: 'REPORTS_BUSY' });
    expect(waiting.response.headers['Retry-After']).toBeUndefined();
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 0 });
    work.next('done');
    work.complete();
    await running;
  });
});
